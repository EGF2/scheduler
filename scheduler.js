"use strict";

/* eslint camelcase: 0 */

const clientData = require("./components").clientData;
const log = require("./components").logger;
const searcher = require("./components").searcher;
const CronJob = require("cron").CronJob;
let crontab = [];

function validateSchedule(schedule, errorHandler) {
    let problemMessage = "";

    if (!schedule.listener) {
        problemMessage += "no listener\n";
    } else if (typeof schedule.listener !== "string") {
        problemMessage += "listener is not string\n";
    }

    if (schedule.schedule_code && typeof schedule.schedule_code !== "string") {
        problemMessage += "schedule_code is not string\n";
    }

    if (schedule.time) {
        let testDate = new Date(null, null, null,
            schedule.time.hour,
            schedule.time.minute,
            schedule.time.second);

        if (testDate.getTime() !== testDate.getTime()) {
            problemMessage += `invalid time: ${JSON.stringify(schedule.time)}\n`;
        }
    } else {
        problemMessage += "no time\n";
    }

    if (schedule.repeat) {
        // "daily" not requiring date
        if (schedule.repeat !== "daily") {
            // repeat with date
            if (schedule.date) {
                let day_of_week = schedule.date.day_of_week;
                let day = schedule.date.day;
                let month = schedule.date.month;

                switch (schedule.repeat) {
                case "weekly":
                    if (typeof day_of_week !== "number" ||
                        day_of_week < 0 ||
                        day_of_week > 6 ||
                        Math.floor(day_of_week) !== day_of_week) {
                        problemMessage += `invalid day_of_week: ${JSON.stringify(day_of_week)}\n`;
                    }
                    break;
                case "monthly":
                    if (typeof day !== "number" ||
                        day < 1 ||
                        day > 31 ||
                        Math.floor(day) !== day) {
                        problemMessage += `invalid day: ${JSON.stringify(day)}\n`;
                    }
                    break;
                case "yearly":
                    if (typeof day !== "number" ||
                        day < 1 ||
                        day > 31 ||
                        Math.floor(day) !== day) {
                        problemMessage += `invalid day: ${JSON.stringify(day)}\n`;
                    }
                    if (typeof month !== "number" ||
                        month < 0 ||
                        month > 11 ||
                        Math.floor(month) !== month) {
                        problemMessage += `invalid month: ${JSON.stringify(month)}\n`;
                    }
                    break;
                default:
                    problemMessage += `invalid repeat: ${JSON.stringify(schedule.repeat)}\n`;
                    break;
                }
            } else {
                problemMessage += "no date\n";
            }
        }
    } else if (schedule.date) { // no repeat must have date
        let testDate = new Date(schedule.date.year, schedule.date.month, schedule.date.day);
        if (testDate.getTime() !== testDate.getTime()) {
            problemMessage += `invalid date: ${JSON.stringify(schedule.date)}\n`;
        }
    } else {
        problemMessage += "no date and no repeat\n";
    }

    if (problemMessage) {
        if (typeof errorHandler === "function") {
            errorHandler("Schedule is invalid: \n" + problemMessage);
        }
        return false;
    }
    return true;
}

function emitScheduleEvent(schedule, listener, schedule_code) {
    clientData.createObject({
        object_type: "schedule_event",
        schedule,
        schedule_code,
        listener
    }).then(
        resp => log.debug("ScheduleEvent emitted:\n", resp),
        err => log.error("ScheduleEvent not emitted:\n", err)
    ).catch(e => log.error("ScheduleEvent not emitted:\n", e));
}

function recordSchedule(schedule, testMode) {
    let year = schedule.date && schedule.date.year;
    let month = schedule.date && schedule.date.month;
    let day = schedule.date && schedule.date.day;
    let day_of_week = schedule.date && schedule.date.day_of_week;
    let hour = schedule.time.hour;
    let minute = schedule.time.minute;
    let second = schedule.time.second;

    function record(time) {
        /**
         * IN TEST MODE
         * Repeat becomes secondly
         * Date without repeat becomes second after now
         */
        if (testMode) {
            if (typeof time === "string") {
                time = "* * * * * *";
            } else {
                let d = new Date();
                d.setSeconds(d.getSeconds() + 1);
                time = d;
            }
        }
        crontab.push(
            {
                id: schedule.id,
                cronJob: new CronJob(time, () => {
                    emitScheduleEvent(schedule.id, schedule.listener, schedule.schedule_code);
                    if (!schedule.repeat) {
                        clientData.deleteObject(schedule.id);
                    }
                }, null, true)
            }
        );
    }

    switch (schedule.repeat) {
    case "daily":
        record(`${second} ${minute} ${hour} * * *`);
        break;
    case "weekly":
        record(`${second} ${minute} ${hour} * * ${day_of_week}`);
        break;
    case "monthly":
        record(`${second} ${minute} ${hour} ${day} * *`);
        break;
    case "yearly":
        record(`${second} ${minute} ${hour} ${day} ${month} *`);
        break;
    default: {
        let date = new Date(year, month, day, hour, minute, second);
        record(date);
        break;
    }
    }
    log.debug("Schedule created:\n", schedule);
}

function deleteSchedule(schedule) {
    crontab.some((element, index) => {
        if (element.id === schedule.id) {
            crontab[index].cronJob.stop();
            delete crontab[index].cronJob;
            crontab.splice(index, 1);
            log.debug("Schedule deleted:\n", schedule);
            return true;
        }
        log.error("Schedule not deleted (not found):\n", schedule);
        return false;
    });
}

function loadSchedules(testMode) {
    clientData.forEachPage(
        last => searcher.search({object: "schedule", count: 100, after: last}),
        found => {
            let promises = [];
            let schedules = [];

            log.debug("Schedule IDs from elastic:\n", found);

            found.results.map(fileId => {
                promises.push(clientData.getObject(fileId).then(schedule => schedules.push(schedule))
                    .catch(err => log.error(err)));
                return null;
            });
            return Promise.all(promises).then(() => {
                schedules.forEach(schedule => {
                    if (validateSchedule(schedule)) {
                        recordSchedule(schedule, testMode);
                    }
                });
            }).catch(err => log.error(err));
        }
    );
}

/**
 * Stop and delete all Schedules
 * Only for testing
 */
function clear() {
    crontab.forEach((element, index) => {
        element.cronJob.stop();
        delete crontab[index].cronJob;
    });
    crontab = [];
}

module.exports = {
    loadSchedules,
    validateSchedule,
    recordSchedule,
    deleteSchedule,
    clear
};
