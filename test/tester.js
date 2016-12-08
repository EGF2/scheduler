"use strict";

const _ = require("underscore");
const elasticsearch = require("elasticsearch");
const MockService = require("./MockService");
const Scheduler = require("../scheduler");
const clientData = require("../components").clientData;
let scheduleEvents = [];
let lastValidateError = null;
let scheduleCreated = null;
let recording = true;

function eventHandler(event) {
    if (event.method === "POST" && event.current) {
        if (recording && event.current.object_type === "schedule") {
            if (Scheduler.validateSchedule(event.current, err => {
                lastValidateError = err;
            })) {
                Scheduler.recordSchedule(event.current, true);
            }
        } else if (event.current.object_type === "schedule_event") {
            scheduleEvents.push(event.current);
        }
    } else if (recording && event.method === "DELETE" &&
        event.previous &&
        event.previous.object_type === "schedule") {
        Scheduler.deleteSchedule(event.previous);
    }
}

let service = new MockService(eventHandler);

function same(array) {
    return array.every(obj => {
        return (obj.schedule === array[0].schedule &&
        obj.object_type === array[0].object_type &&
        obj.listener === array[0].listener &&
        obj.schedule_code === array[0].schedule_code);
    });
}

function compare(schedule, scheduleEvent) {
    let problemMessage = "";

    if (scheduleEvent.object_type !== "schedule_event") {
        problemMessage += `Wrong object_type. Expected schedule_event. Got ${scheduleEvent.object_type}`;
    }

    if (scheduleEvent.schedule !== schedule.id) {
        problemMessage += `Wrong schedule. Expected ${schedule.id}. Got ${scheduleEvent.schedule}`;
    }

    if (scheduleEvent.listener !== schedule.listener) {
        problemMessage += `Wrong listener. Expected ${schedule.listener}. Got ${scheduleEvent.listener}`;
    }

    if (scheduleEvent.schedule_code !== schedule.schedule_code) {
        problemMessage += `Wrong listener. Expected ${schedule.schedule_code}. Got ${scheduleEvent.schedule_code}`;
    }

    return problemMessage;
}

function wait(ms) {
    return new Promise(resolve => {
        setTimeout(() => {
            resolve();
        }, ms);
    });
}

function error(message) {
    Scheduler.clear();
    throw Error(`${message}\n\nLast Schedule Created:\n${JSON.stringify(scheduleCreated, null, 4)}\n\nScheduleEvents:\n${JSON.stringify(scheduleEvents, null, 4)}\n\nLast validator error:\n${lastValidateError}`);
}

function testStaticSchedule(done, caze, statics) {
    lastValidateError = null;
    scheduleEvents = [];
    recording = true;
    clientData.createObject(statics[caze]).then(schedule => {
        scheduleCreated = schedule;
        return wait(2400);
    }).then(() => {
        if (scheduleEvents.length === 1) {
            let err = compare(scheduleCreated, scheduleEvents[0]);
            if (err) {
                error(`Wrong ScheduleEvent emitted:\n${err}`);
            }
            lastValidateError = null;
            scheduleEvents = [];
            return;
        } else if (scheduleEvents.length > 1) {
            if (same(scheduleEvents)) {
                error("Static Schedule emitting repeatedly!");
            } else {
                error("Static Schedule emitted several not same ScheduleEvents!");
            }
        }
        error("ScheduleEvent not emitted!");
    }).then(() => {
        return wait(1200);
    }).then(() => {
        if (scheduleEvents.length) {
            if (compare(scheduleCreated, scheduleEvents[0])) {
                error("After static Schedule emitted ScheduleEvent it continue emitting, and it doesn't match Schedule!");
            } else {
                error("After static Schedule emitted ScheduleEvent it continue emitting!");
            }
        } else {
            // Creating schedule again and deleting immediately
            lastValidateError = null;
            scheduleEvents = [];
            return clientData.createObject(statics[caze]).then(schedule => clientData.deleteObject(schedule.id));
        }
    }).then(() => {
        return wait(1200);
    }).then(() => {
        if (scheduleEvents.length) {
            if (compare(scheduleCreated, scheduleEvents[0])) {
                error("Static Schedule still emit ScheduleEvent after deleting, and it doesn't match Schedule!");
            } else {
                error("Static Schedule still emit ScheduleEvent after deleting!");
            }
        }
        done();
    }).catch(err => {
        done(err);
    });
}

function testRepeatingSchedule(done, caze, repeats) {
    lastValidateError = null;
    scheduleEvents = [];
    recording = true;
    clientData.createObject(repeats[caze]).then(schedule => {
        scheduleCreated = schedule;
        return wait(2400);
    }).then(() => {
        if (scheduleEvents.length > 1) {
            if (same(scheduleEvents)) {
                let err = compare(scheduleCreated, scheduleEvents[0]);
                if (err) {
                    error(`Wrong ScheduleEvent emitted:\n${err}`);
                }
                lastValidateError = null;
                scheduleEvents = [];
                return clientData.deleteObject(scheduleCreated.id);
            }
            error("Emitted several not same ScheduleEvents!");
        } else if (scheduleEvents.length === 1) {
            let err = compare(scheduleCreated, scheduleEvents[0]);
            if (err) {
                error(`Repeating event emitted only 1 time and it's wrong!:\n${err}`);
            }
            error("Repeating event emitted only 1 time!");
        }
        error("ScheduleEvent not emitted!");
    }).then(() => {
        return wait(1200);
    }).then(() => {
        if (scheduleEvents.length) {
            if (compare(scheduleCreated, scheduleEvents[0])) {
                error("After Schedule deletion ScheduleEvent still emitting, and they doesn't match Schedule!");
            } else {
                error("After Schedule deletion ScheduleEvent still emitting!");
            }
        } else {
            done();
        }
    }).catch(err => {
        done(err);
    });
}

function testInvalidSchedule(done, caze, invalids) {
    lastValidateError = null;
    scheduleEvents = [];
    recording = true;
    clientData.createObject(invalids[caze]).then(schedule => {
        scheduleCreated = schedule;
        return wait(1200);
    }).then(() => {
        if (scheduleEvents.length) {
            let err = compare(scheduleCreated, scheduleEvents[0]);
            if (err) {
                error(`ScheduleEvent emitted, and it's wrong:\n${err}`);
            }
            error("ScheduleEvent emitted!");
        }
        done();
    }).catch(err => {
        done(err);
    });
}

let elasticClient = new elasticsearch.Client({
    hosts: [
        "localhost:9200"
    ]
});

function createIndex() {
    return elasticClient.indices.exists({index: "schedule"}).then(exists => {
        if (!exists) {
            return elasticClient.indices.create({
                index: "schedule",
                body: {
                    mappings: {
                        schedule: {
                            properties: {
                                id: {
                                    type: "string",
                                    index: "not_analyzed"
                                }
                            }
                        }
                    }
                }
            }).then(() => error("There was no index, new one created, test again."));
        }
    });
}

function testElasticLoad(done, cases) {
    Scheduler.clear();
    scheduleEvents = [];
    lastValidateError = null;
    recording = false;
    createIndex().then(() => wait(1000)).then(() => {
        let creations = [];
        let indexions = [];

        // Create objects and put them in elasticsearch
        _.keys(cases).forEach(caze => {
            creations.push(clientData.createObject(cases[caze])
                .then(obj => {
                    indexions.push(elasticClient.index({
                        index: "schedule",
                        type: "schedule",
                        id: obj.id,
                        body: {
                            id: obj.id
                        }
                    }));
                }).catch(err => done(err))
            );
        });

        Promise.all(creations).then(() => Promise.all(indexions)).then(() => wait(1000)).then(() => {
            Scheduler.loadSchedules(true);
            wait(1400).then(() => {
                if (scheduleEvents.length === _.keys(cases).length) {
                    let valid = _.keys(cases).every(caze => {
                        return scheduleEvents.some(event => {
                            return compare(cases[caze], event);
                        });
                    });
                    if (valid) {
                        done();
                    } else {
                        error(`Cases do not match ScheduleEvents!\n\nCases Created:\n${JSON.stringify(cases, null, 4)}`);
                    }
                } else {
                    error(`Number of ScheduleEvents not equals to number of cases!\n\nCases Created:\n${JSON.stringify(cases, null, 4)}`);
                }
            }).catch(err => done(err));
        }).catch(err => done(err));
    }).catch(err => done(err));
}

module.exports = {
    testStaticSchedule,
    testRepeatingSchedule,
    testInvalidSchedule,
    testElasticLoad,
    service
};
