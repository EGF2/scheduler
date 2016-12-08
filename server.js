"use strict";

const eventConsumer = require("commons/event-consumer");
const config = require("./components").config;
const log = require("./components").logger;
const Scheduler = require("./scheduler");

/**
 * testMode make ScheduleEvents emit almost instantly
 * Do not use it in production! As it will delete static Schedules.
 * @param testMode
 */
function createServer(testMode) {
    function eventHandler(event) {
        if (event.method === "POST" &&
            event.current &&
            event.current.object_type === "schedule" &&
            Scheduler.validateSchedule(event.current, log.error.bind(log))) {
            Scheduler.recordSchedule(event.current, testMode);
        } else if (event.method === "DELETE" &&
            event.previous &&
            event.previous.object_type === "schedule") {
            Scheduler.deleteSchedule(event.previous);
        }
    }

    function errorHandler(error) {
        log.error("errorHandler: ", error);
    }

    eventConsumer(config, eventHandler, errorHandler).then(() => {
        log.info("scheduler started");
        if (testMode) {
            log.warn("scheduler started in test mode");
        }
        Scheduler.loadSchedules(testMode);
    }).catch(e => log.fatal("scheduler not started: ", e));
}

module.exports = createServer;
