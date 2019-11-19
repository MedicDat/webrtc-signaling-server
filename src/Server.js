import express from 'express';
var app = express();
import fs from 'fs';
import ws from 'ws';
import http from 'http';
import https from 'https';
import path from 'path';
const MessagePack = require('what-the-pack');
const {encode, decode, register} = MessagePack.initialize(2**22);
var moment = require('moment');
var log = require('loglevel');
log.setLevel(log.levels.DEBUG) //change this to DEBUG for verbose

app.use(express.static(path.join(process.cwd(),"dist")));

var toHHMMSS = function (secs) {
    var sec_num = parseInt(secs, 10);
    var hours   = Math.floor(sec_num / 3600);
    var minutes = Math.floor((sec_num - (hours * 3600)) / 60);
    var seconds = sec_num - (hours * 3600) - (minutes * 60);

    if (hours   < 10) {hours   = "0"+hours;}
    if (minutes < 10) {minutes = "0"+minutes;}
    if (seconds < 10) {seconds = "0"+seconds;}
    return hours + ':' + minutes + ':' + seconds;
}

export default class CallHandler {

    constructor() {
        this.wss = null;
        this.ws = null;
        this.clients = new Set();
        this.server = null;
        this.ssl_server = null;
        this.sessions = [];
        //some debug info
        this.start_time = moment();
        this.peer_no = 0;
    }

    init() {

        var ws_server_port = (process.env.PORT || 4442);
        this.server = http.createServer(app).listen(ws_server_port, () => {
            log.debug("Start WS Server: bind => ws://0.0.0.0:"+ws_server_port);
        });

        this.ws = new ws.Server({ server: this.server });
        this.ws.on('connection', this.onConnection);


        var options = {
            key: fs.readFileSync('certs/key.pem'),
            cert: fs.readFileSync('certs/cert.pem')
        };

        var wss_server_port = (process.env.PORT + 1 || 4443);
        this.ssl_server = https.createServer(options, app).listen(wss_server_port, () => {
            log.debug("Start WSS Server: bind => wss://0.0.0.0:"+wss_server_port);
        });

        this.wss = new ws.Server({ server: this.ssl_server });
        this.wss.on('connection', this.onConnection);

        //register object keys -> smaller buffer size
        register('type', 'reject', 'id', 'name', 'user_agent', 'session_id', 'from', 'to', 'media', 'description', 'candidate');
    }

    updatePeers = () => {
        var peers = [];
        
        this.peer_no = 0;

        this.clients.forEach(function (client) {
            var peer = {};
            if (client.hasOwnProperty('id')) {
                peer.id = client.id;
            }
            if (client.hasOwnProperty('name')) {
                peer.name = client.name;
            }
            if (client.hasOwnProperty('user_agent')) {
                peer.user_agent = client.user_agent;
            }
            if (client.hasOwnProperty('session_id')) {
                peer.session_id = client.session_id;
            }
            peers.push(peer);
        });
        
        this.peer_no = peers.length;

        var msg = {
            type: "peers",
            data: peers,
        };

        let _send = this._send;
        this.clients.forEach(function (client) {
            _send(client, encode(msg));
        });
    }
    
    getPeerNo = () => {
        return this.peer_no;
    }
    
    getUptime = () => {
        return toHHMMSS(moment().diff(this.start_time, 'seconds'));
    }
    
    getPeers = () => {
        var peers = [];
        this.clients.forEach(function (client) {
            var peer = {};
            if (client.hasOwnProperty('name')) {
                peer.name = client.name;
            }
            peers.push(peer.name);
        });
        return peers.join();
    }

    onClose = (client_self, data) => {
        log.debug('close');
        var session_id = client_self.session_id;
        //remove old session_id
        if (session_id !== undefined) {
            for (let i = 0; i < this.sessions.length; i++) {
                let item = this.sessions[i];
                if (item.id == session_id) {
                    this.sessions.splice(i, 1);
                    break;
                }
            }
        }
        var msg = {
            type: "leave",
            data: client_self.id,
        };

        let _send = this._send;
        this.clients.forEach(function (client) {
            if (client != client_self)
            _send(client, encode(msg));
        });

        this.updatePeers();
    }

    onConnection = (client_self, socket) => {
        log.debug('connection');

        let _send = this._send;

        this.clients.add(client_self);

        client_self.on("close", (data) => {
            this.clients.delete(client_self);
            this.onClose(client_self, data)
        });

        client_self.on("message", message => {
            try {
                message = decode(message);
                log.debug("message.type:: " + message.type + ", \nbody: " + encode(message));
            } catch (e) {
                log.debug(e.message);
            }

            switch (message.type) {
                case 'new':
                    {
                        client_self.id = "" + message.id;
                        client_self.name = message.name;
                        client_self.user_agent = message.user_agent;
                        this.updatePeers();
                    }
                    break;
                case 'bye':
                    {
                        var session = null;
                        this.sessions.forEach((sess) => {
                            if (sess.id == message.session_id) {
                                session = sess;
                            }
                        });

                        if (!session) {
                            var msg = {
                                type: "error",
                                data: {
                                    error: "Invalid session " + message.session_id,
                                },
                            };
                            _send(client_self, encode(msg));
                            return;
                        }

                        this.clients.forEach((client) => {
                            if (client.session_id === message.session_id) {
                                try {

                                    var msg = {
                                        type: "bye",
                                        data: {
                                            session_id: message.session_id,
                                            from: message.from,
                                            to: (client.id == session.from ? session.to : session.from),
                                        },
                                    };
                                    _send(client, encode(msg));
                                } catch (e) {
                                    log.debug("onUserJoin:" + e.message);
                                }
                            }
                        });
                    }
                    break;
                case "offer":
                    {
                        var peer = null;
                        this.clients.forEach(function (client) {
                            if (client.hasOwnProperty('id') && client.id === "" + message.to) {
                                peer = client;
                            }
                        });

                        if (peer != null) {

                            msg = {
                                type: "offer",
                                data: {
                                    to: peer.id,
                                    from: client_self.id,
                                    media: message.media,
                                    session_id: message.session_id,
                                    description: message.description,
                                }
                            }
                            _send(peer, encode(msg));

                            peer.session_id = message.session_id;
                            client_self.session_id = message.session_id;

                            let session = {
                                id: message.session_id,
                                from: client_self.id,
                                to: peer.id,
                            };
                            this.sessions.push(session);
                        }

                        break;
                    }
                case 'answer':
                    {
                        var msg = {
                            type: "answer",
                            reject: false,
                            data: {
                                from: client_self.id,
                                to: message.to,
                                description: message.description,
                            }
                        };
                        if (!message.accept) {
                            msg.reject = true;
                        }

                        this.clients.forEach(function (client) {
                            if (client.id === "" + message.to && client.session_id === message.session_id) {
                                try {
                                    _send(client, encode(msg));
                                } catch (e) {
                                    log.debug("onUserJoin:" + e.message);
                                }
                            }
                        });
                    }
                    break;
                case 'candidate':
                    {
                        var msg = {
                            type: "candidate",
                            data: {
                                from: client_self.id,
                                to: message.to,
                                candidate: message.candidate,
                            }
                        };
                        
                        this.clients.forEach(function (client) {
                            if (client.id === "" + message.to && client.session_id === message.session_id) {
                                try {
                                    _send(client, encode(msg));
                                } catch (e) {
                                    log.debug("onUserJoin:" + e.message);
                                }
                            }
                        });
                    }
                    break;
                case 'keepalive':
                    _send(client_self, encode({type:'keepalive', data:{}}));
                    break;
                default:
                    log.debug("Unhandled message: " + message.type);
            }
        });
    }

    _send = (client, message) => {
        try {
            client.send(message);
        }catch(e){
            log.debug("Send failure !: " + e);
        }
    }
}

let callHandler = new CallHandler();
callHandler.init();

//debug route
app.get('/debug', function(req, res) {
    var response = {
        "NocP": callHandler.getPeerNo(),
        "Uptime": callHandler.getUptime(),
        "Peers": callHandler.getPeers()
    }
    //JSON is fine cause debug is only used internally
    res.send(JSON.stringify(response));
});

app.listen(4444, function() { log.debug("started debug api") });

