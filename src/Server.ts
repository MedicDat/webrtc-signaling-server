import express from 'express';
let app = express();
import ws from 'ws';
import http from 'http';
import path from 'path';
import zlib from "zlib";
import MessagePack from 'what-the-pack';
const {encode, decode} = MessagePack.initialize(2**22);
import moment from 'moment';
import log from 'loglevel';
import jwt from "express-jwt";
import getJWTInfos from "./config/redis";
log.setLevel(process.env.DEVELOP ? log.levels.DEBUG : log.levels.ERROR);

app.use(express.static(path.join(process.cwd(),"dist")));
getJWTInfos().then((infos) => {
    app.use(jwt({secret: infos.jwtSecret, issuer: infos.jwtIssuer, algorithms: ["SHA256"]}).unless({path: ["/debug"]}));
});

let toHHMMSS = function (secs: number) {
    let hours: number   = Math.floor(secs / 3600);
    let minutes: number = Math.floor((secs - (hours * 3600)) / 60);
    let seconds: number = secs - (hours * 3600) - (minutes * 60);
    return `${hours < 10 ? "0" + hours : hours}:${minutes < 10 ? "0" + minutes : minutes}:${seconds < 10 ? "0" + seconds : seconds}`;
}

export default class CallHandler {

    wss: ws.Server | null = null;
    ws: ws.Server | null = null;
    clients = new Set();
    server: http.Server | null = null;
    ssl_server: http.Server | null = null;
    sessions: any = [];
    // some debug info
    start_time = moment();
    peer_no = 0;

    init() {

        let wss_server_port = 4443;
        this.ssl_server = http.createServer(app).listen(wss_server_port, () => {
            log.debug("Start WSS Server: bind => wss://0.0.0.0:"+wss_server_port);
        });

        this.wss = new ws.Server({ server: this.ssl_server });
        this.wss.on('connection', this.onConnection);

    }

    updatePeers = () => {
        let peers: any = [];
        log.debug("updating peers...");
        this.peer_no = 0;

        this.clients.forEach(function (client: any) {
            let peer: any = {
                id: client.id,
                name: client.name,
                in_call: client.in_call
            };
            peers.push(peer);
        });
        
        this.peer_no = peers.length;

        let msg = {
            type: "peers",
            data: peers,
        };

        let _send = this._send;
        this.clients.forEach(function (client) {
            _send(client, msg);
        });
    }
    
    updatePeersWithInCallPeers = (session_id: any) => {
        let peers: any = [];
        log.debug("updating peer call state")

        this.clients.forEach(function (client: any) {
            // only update clients in call
            if (client.session_id == session_id) {
                let peer: any = {
                    id: client.id,
                    name: client.name,
                    in_call: client.in_call
                };
                peers.push(peer);
            }
        });

        // we can recycle the channel cause frontend only updates the two in call :+1:
        let msg = {
            type: "peers",
            data: peers,
        };

        let _send = this._send;
        this.clients.forEach(function (client: any) {
            // only send to clients that are not having a call
            if (client.session_id != session_id) {
                _send(client, msg);
            }
        });
    }

    updateSetEntriesCallStatus = (status: any, ids: any) => {
        let client1: any, client2: any;
        this.clients.forEach(function (client: any) {
            if (client.id == ids[0]) {
                client1 = client;
            } else if (client.id == ids[1]) {
                client2 = client;
            }
        });
        this.clients.delete(client1);
        this.clients.delete(client2);

        if (client1!! && client2!!) {
            client1.in_call = status;
            client2.in_call = status;
        }

        this.clients.add(client1).add(client2);
    }

    getPeerNo = () => {
        return this.peer_no;
    }
    
    getUptime = () => {
        return toHHMMSS(moment().diff(this.start_time, 'seconds'));
    }
    
    getPeers = () => {
        let peers: any = [];
        this.clients.forEach(function (client : any) {
            let peer: any = {
                id: client.id,
                name: client.name,
                in_call: client.in_call
            };
            peers.push(peer.name);
        });
        return peers.join();
    }

    onClose = (client_self: any, data: any) => {
        log.debug('close');
        let session_id = client_self.session_id;
        //remove old session_id
        if (session_id !== undefined) {
            for (let i = 0; i < this.sessions.length; i++) {
                let item: any = this.sessions[i];
                if (item.id == session_id) {
                    this.sessions.splice(i, 1);
                    break;
                }
            }
        }
        let msg = {
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

    onConnection = (client_self: any, socket: any) => {
        log.debug('connection');

        let _send = this._send;

        this.clients.add(client_self);

        client_self.on("close", (data: any) => {
            this.clients.delete(client_self);
            this.onClose(client_self, data)
        });

        client_self.on("message", (message: any) => {
            zlib.unzip(message, (err: any, buffer: any) => {
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
                                    let receiver: any = null;
                                    this.clients.forEach((client: any) => {
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
                                    let session: any = null;
                                    this.sessions.forEach((sess: any) => {
                                        if (sess.id == message.session_id) {
                                            session = sess;
                                        }
                                    });
            
                                    if (!session) {
                                        let msg = {
                                            type: "error",
                                            data: {
                                                error: "Invalid session " + message.session_id,
                                            },
                                        };
                                        _send(client_self, msg);
                                        return;
                                    }
            
                                    this.updateSetEntriesCallStatus(false, [session.from, session.to]);

                                    this.clients.forEach((client: any) => {
                                        if (client.session_id === message.session_id) {
                                            try {
            
                                                let msg = {
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
                                    let peer: any = null;
                                    this.clients.forEach(function (client: any) {
                                        if (client.hasOwnProperty('id') && client.id === "" + message.to) {
                                            peer = client;
                                        }
                                    });
            
                                    if (peer != null) {
            
                                        let msg = {
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
                                    let msg = {
                                        type: "answer",
                                        data: {
                                            from: client_self.id,
                                            to: message.to,
                                            description: message.description,
                                        }
                                    };
            
                                    this.clients.forEach(function (client: any) {
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
                                    let msg = {
                                        type: "candidate",
                                        data: {
                                            from: client_self.id,
                                            to: message.to,
                                            candidate: message.candidate,
                                        }
                                    };
                                    
                                    this.clients.forEach(function (client: any) {
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

    _send = (client: any, message: any) => {
        log.debug("send: " + message.toString() + "\n"); 
        zlib.deflate(encode(message), {level: zlib.Z_BEST_COMPRESSION}, (err, buffer) => {
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

app.listen(4444, "0.0.0.0", () => log.debug("listening on debug port"));

