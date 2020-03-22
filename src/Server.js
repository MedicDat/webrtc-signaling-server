import express from 'express';
var app = express();
import ws from 'ws';
import http from 'http';
import path from 'path';
const zlib = require("zlib");
const MessagePack = require('what-the-pack');
const {encode, decode} = MessagePack.initialize(2**22);
var moment = require('moment');
var log = require('loglevel');
log.setLevel(log.levels.ERROR) //change this to DEBUG for verbose

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

        let wss_server_port = (process.env.PORT + 1 || 4443);
        this.ssl_server = http.createServer(app).listen(wss_server_port, "localhost", () => {
            log.debug("Start WSS Server: bind => wss://0.0.0.0:"+wss_server_port);
        });

        this.wss = new ws.Server({ server: this.ssl_server });
        this.wss.on('connection', this.onConnection);

    }

    updatePeers = () => {
        var peers = [];
        log.debug("updating peers...");
        this.peer_no = 0;

        this.clients.forEach(function (client) {
            var peer = {};
            if (client.hasOwnProperty('id')) {
                peer.id = client.id;
            }
            if (client.hasOwnProperty('name')) {
                peer.name = client.name;
            }
            if (client.hasOwnProperty('in_call')) {
                peer.in_call = client.in_call;
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
            _send(client, msg);
        });
    }
    
    updatePeersWithInCallPeers = (session_id) => {
        let peers = [];
        log.debug("updating peer call state")

        this.clients.forEach(function (client) {
            // only update clients in call
            if (client.session_id == session_id) {
                let peer = {};
                if (client.hasOwnProperty('id')) {
                    peer.id = client.id;
                }
                if (client.hasOwnProperty('name')) {
                    peer.name = client.name;
                }
                if (client.hasOwnProperty('in_call')) {
                    peer.in_call = client.in_call;
                }
                if (client.hasOwnProperty('session_id')) {
                    peer.session_id = client.session_id;
                }
                peers.push(peer);
            }
        });

        // we can recycle the channel cause frontend only updates the two in call :+1:
        let msg = {
            type: "peers",
            data: peers,
        };

        let _send = this._send;
        this.clients.forEach(function (client) {
            // only send to clients that are not having a call
            if (client.session_id != session_id) {
                _send(client, msg);
            }
        });
    }

    updateSetEntriesCallStatus = (status, ids) => {
        let client1, client2;
        this.clients.forEach(function (client) {
            if (client.id == ids[0]) {
                client1 = client;
            } else if (client.id == ids[1]) {
                client2 = client;
            }
        });
        this.clients.delete(client1);
        this.clients.delete(client2);

        client1.in_call = status;
        client2.in_call = status;

        this.clients.add(client1).add(client2);
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
            _send(client, msg);
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
            zlib.unzip(message, (err, buffer) => {
                    if (!err) {
                        message = decode(buffer);
                        // log.debug("message.type:: " + message.type + ", \nbodyBytes: " + encode(message) + "\n");
                        // log.debug(message.name + "\n");
                        log.debug(message.toString() + "\n");

                        switch (message.type) {
                            case 'new':
                                {
                                    client_self.id = "" + message.id;
                                    client_self.name = message.name;
                                    client_self.in_call = message.in_call;
                                    this.updatePeers();
                                }
                                break;
                            case 'push':
                                {
                                    let receiver = null;
                                    this.clients.forEach(client => {
                                        if (client.hasOwnProperty('id') && client.id === "" + message.to) {
                                            receiver = client;
                                        }
                                    });
                                    log.debug(receiver + "\n");
                                    if (receiver != null) {
                                        let msg = {
                                            type: "push",
                                            data: {
                                                to: receiver.id,
                                                fromUser: message.from_user,
                                            }
                                        }
                                        _send(receiver, msg);
                                    }
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
                                        _send(client_self, msg);
                                        return;
                                    }
            
                                    this.updateSetEntriesCallStatus(false, [session.from, session.to]);

                                    this.clients.forEach((client) => {
                                        if (client.session_id === message.session_id) {
                                            try {
            
                                                var msg = {
                                                    type: "bye",
                                                    data: {
                                                        session_id: message.session_id,
                                                        from: message.from,
                                                        to: (client.id == session.from ? session.to : session.from),
                                                        callBack: message.callBack,
                                                    },
                                                };
                                                _send(client, msg);
                                            } catch (e) {
                                                log.debug("onUserJoin:" + e.message);
                                            }
                                        }
                                    });

                                    this.updatePeersWithInCallPeers(session.id);
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
                                                fromUser: message.fromUser,
                                                session_id: message.session_id,
                                                description: message.description,
                                            }
                                        }
                                        _send(peer, msg);
            
                                        peer.session_id = message.session_id;
                                        client_self.session_id = message.session_id;
            
                                        let session = {
                                            id: message.session_id,
                                            from: client_self.id,
                                            to: peer.id,
                                        };
                                        this.sessions.push(session);
                                    }
                                }
                                break;
                            case 'answer':
                                {
                                    var msg = {
                                        type: "answer",
                                        data: {
                                            from: client_self.id,
                                            to: message.to,
                                            description: message.description,
                                        }
                                    };
            
                                    this.clients.forEach(function (client) {
                                        if (client.id === "" + message.to && client.session_id === message.session_id) {
                                            try {
                                                _send(client, msg);
                                            } catch (e) {
                                                log.debug("onUserJoin:" + e.message);
                                            }
                                        }
                                    });
                                    
                                    this.updateSetEntriesCallStatus(true, [client_self.id, message.to]);

                                    // getting answer from client means he accepted call!
                                    this.updatePeersWithInCallPeers(message.session_id);
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
                                                _send(client, msg);
                                            } catch (e) {
                                                log.debug("onUserJoin:" + e.message);
                                            }
                                        }
                                    });
                                }
                                break;
                            case 'keepalive':
                                _send(client_self, {type:'keepalive', data:{}});
                                break;
                            default:
                                log.debug("Unhandled message: " + message.type);
                        }
                    } else {
                        log.error(err);
                    }
                }
            );
        });
    }

    _send = (client, message) => {
        log.debug("send: " + message.toString() + "\n");
        zlib.deflate(encode(message), zlib.Z_BEST_COMPRESSION, (err, buffer) => {
            if (!err) {
                client.send(buffer);
            } else {
                log.error("Send failure !: " + err);
            }
          }
        );
    }
}

let callHandler = new CallHandler();
callHandler.init();

// DEBUG API //

//debug route
app.get('/debug', function(req, res) {
    let response = {
        "NocP": callHandler.getPeerNo(),
        "Uptime": callHandler.getUptime(),
        "Peers": callHandler.getPeers()
    }
    //JSON is fine cause debug is only used internally
    res.send(JSON.stringify(response));
});

app.listen(4444, "localhost", () => log.debug("listening on debug port"));

