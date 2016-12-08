"use strict";

/* eslint camelcase: 0 */

const log = require("../components").logger;
const restify = require("restify");
const uuid = require("node-uuid");

/**
 * ClientData and EventConsumer emulation
 */
module.exports = class MockService {
    constructor(eventHandler) {
        this.db = [];
        this.eventHandler = eventHandler;
        this.createServer().listen(8000, () => {
            log.info("mock-client-data started");
        });
    }

    postObject(obj) {
        if (obj.object_type === "schedule_event") {
            obj.id = `${uuid.v4()}-08`;
        } else {
            obj.id = `${uuid.v4()}-07`;
        }
        this.db.push(obj);
        this.eventHandler({
            created_at: "mock",
            current: obj,
            id: `${uuid.v4()}-04`,
            method: "POST",
            object: obj.id,
            object_type: "event"
        });
        return obj;
    }

    deleteObject(id) {
        let obj;
        this.db.some((element, index) => {
            if (element.id === id) {
                obj = this.db.splice(index, 1)[0];
                return true;
            }
            return false;
        });
        if (obj) {
            this.eventHandler({
                created_at: "mock",
                id: `${uuid.v4()}-04`,
                method: "DELETE",
                object: obj.id,
                object_type: "event",
                previous: obj
            });
            return obj;
        }
    }

    getObjects(ids) {
        return this.db.filter(object => {
            return ids.indexOf(object.id) > -1;
        });
    }

    createServer() {
        let server = restify.createServer({
            name: "mock-client-data"
        });

        server.use(restify.queryParser());
        server.use(restify.bodyParser({
            mapParams: false
        }));

        // objects API
        server.get("/v1/graph/:ids", (req, res) => {
            let objects = this.getObjects(req.params.ids.split(","));
            res.send(objects.length > 1 ? objects : objects[0]);
        });
        server.post("/v1/graph", (req, res) => {
            let obj = this.postObject(req.body);
            res.send(obj);
        });
        server.del("/v1/graph/:id", (req, res) => {
            let del = this.deleteObject(req.params.id);
            res.send(del);
        });

        return server;
    }
};
