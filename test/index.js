"use strict";

const _ = require("underscore");
const fs = require("fs");
const path = require("path");
let tester;

let invalids = fs.readdirSync("./test/invalid")
    .map(
        caseFile => ({
            [path.parse(caseFile).name]: require(`./invalid/${caseFile}`)
        })
    ).reduce((r, i) => _.extend(r, i), {});

let statics = fs.readdirSync("./test/valid/static")
    .map(
        caseFile => ({
            [path.parse(caseFile).name]: require(`./valid/static/${caseFile}`)
        })
    ).reduce((r, i) => _.extend(r, i), {});

let repeats = fs.readdirSync("./test/valid/repeat")
    .map(
        caseFile => ({
            [path.parse(caseFile).name]: require(`./valid/repeat/${caseFile}`)
        })
    ).reduce((r, i) => _.extend(r, i), {});

describe("scheduler", function() {
    this.timeout(6000);

    before(done => {
        require("../components").init().then(() => {
            tester = require("./tester");
            done();
        }).catch(err => {
            console.log(err);
            done(err);
        });
    });

    describe("Static Schedules", () => {
        _.keys(statics).forEach(caze => {
            it(`${caze}`, done => {
                tester.testStaticSchedule(done, caze, statics);
            });
        });
    });
    describe("Repeat Schedules", () => {
        _.keys(repeats).forEach(caze => {
            it(`${caze}`, done => {
                tester.testRepeatingSchedule(done, caze, repeats);
            });
        });
    });
    describe("Invalid Schedules", () => {
        _.keys(invalids).forEach(caze => {
            it(`${caze}`, done => {
                tester.testInvalidSchedule(done, caze, invalids);
            });
        });
    });

    /**
     * Warning! Do not test on production!
     * Deleting all existing schedules in elastic!
     */
    describe("Elastic Load", () => {
        it("statics", done => {
            tester.testElasticLoad(done, statics);
        });
    });
});
