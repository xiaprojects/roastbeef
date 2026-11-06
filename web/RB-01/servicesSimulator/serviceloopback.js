/**
 * This file is part of RB.
 *
 * Copyright (C) 2024 XIAPROJECTS SRL
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, version 3.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.

 * This source is part of the project RB:
 * 01 -> Display with Synthetic vision, Autopilot and ADSB
 * 02 -> Display with SixPack
 * 03 -> Display with Autopilot, ADSB, Radio, Flight Computer
 * 04 -> Display with EMS: Engine monitoring system
 * 05 -> Display with Stratux BLE Traffic
 * 06 -> Display with Android 6.25" 7" 8" 10" 10.2"
 *
 * Community edition will be free for all builders and personal use as defined by the licensing model
 * Dual licensing for commercial agreement is available
 * Please join Discord community
 *
 */
/*
    serviceloopback.js: the network, for a page with no daemon behind it.

    simulator.html runs on any static web host, so nothing answers a WebSocket
    and nothing answers the daemon's REST paths. The services and plates are the
    aircraft's own and stay unaware of that: this file replaces WebSocket,
    XMLHttpRequest and fetch underneath them, so the frames servicereplay.js
    pushes arrive through the same onmessage as the daemon's, and a REST call is
    answered by servicedaemon.js.

    Features:
        - Everything else (plates, settings files, map tiles) goes to the network
        - /settings/ follows the page, see LOOPBACK_SITE_ROOT
*/

// The folder holding RB-01/ and settings/: the web root on the aircraft, and any
// folder on a website. The URLs of the settings files are absolute, so without
// this they would only be found in the root of the site.
const LOOPBACK_SITE_ROOT = new URL("../", document.baseURI).pathname;

var loopbackSockets = {};   // path -> the sockets open on it

/**
 * LoopbackSocket: what `new WebSocket` makes on this page
 */
function LoopbackSocket(url) {
    this.path = new URL(url).pathname;
    this.readyState = LoopbackSocket.CONNECTING;
    // As with the real one, the caller sets its handlers before anything fires
    setTimeout(() => {
        if (this.readyState != LoopbackSocket.CONNECTING) {
            return;
        }
        this.readyState = LoopbackSocket.OPEN;
        if (loopbackSockets[this.path] === undefined) {
            loopbackSockets[this.path] = [];
        }
        loopbackSockets[this.path].push(this);
        if (this.onopen) {
            this.onopen({ type: "open" });
        }
        daemonSocketOpened(this.path);
    }, 0);
}

LoopbackSocket.CONNECTING = 0;
LoopbackSocket.OPEN = 1;
LoopbackSocket.CLOSED = 3;

LoopbackSocket.prototype = {
    constructor: LoopbackSocket,

    send: function (data) {
        // The HMI never writes to a socket, only REST
    },

    close: function () {
        if (this.readyState == LoopbackSocket.CLOSED) {
            return;
        }
        this.readyState = LoopbackSocket.CLOSED;
        const sockets = loopbackSockets[this.path] || [];
        if (sockets.indexOf(this) >= 0) {
            sockets.splice(sockets.indexOf(this), 1);
        }
        setTimeout(() => {
            if (this.onclose) {
                this.onclose({ type: "close" });
            }
        }, 0);
    }
};

window.WebSocket = LoopbackSocket;

/**
 * loopbackPush: deliver one frame to every socket open on a path
 * @param {*} path - the socket, as on the daemon: "/situation"
 * @param {*} text - the frame as the daemon would send it, JSON text
 */
function loopbackPush(path, text) {
    (loopbackSockets[path] || []).slice().forEach(socket => {
        // A plate that throws must not cost the others this frame, or the player its tick
        try {
            if (socket.onmessage) {
                socket.onmessage({ data: text });
            }
        } catch (error) {
            console.error(error);
        }
    });
}

// The path of a URL on this site, null for one on another (map tiles and the like).
// charts.js asks for /charts/view//live, the daemon's mux cleans the double slash.
function loopbackPath(url) {
    const parsed = new URL(url, document.baseURI);
    return parsed.origin == window.location.origin ? parsed.pathname.replace(/\/+/g, "/") : null;
}

// Where a request that is not for the daemon really goes
function loopbackUrl(url) {
    const parsed = new URL(url, document.baseURI);
    if (parsed.origin == window.location.origin && parsed.pathname.startsWith("/settings/")) {
        return LOOPBACK_SITE_ROOT + parsed.pathname.substring(1) + parsed.search;
    }
    return url;
}

/**
 * The REST calls of angular's $http. An answer is a blob: URL opened by a real
 * XMLHttpRequest, so the caller sees a genuine response. The route is only taken
 * at send(), which is when the body of a write is known.
 */
class LoopbackXMLHttpRequest extends XMLHttpRequest {
    open(method, url, async) {
        const route = daemonRoute(method, loopbackPath(url));
        this.loopbackRoute = route;
        this.loopbackAsync = async !== false;
        if (route === null) {
            super.open(method, loopbackUrl(url), async !== false);
        }
    }

    setRequestHeader(name, value) {
        if (!this.loopbackRoute) {
            super.setRequestHeader(name, value);
        }
    }

    send(body) {
        if (!this.loopbackRoute) {
            super.send(body);
            return;
        }
        const answer = JSON.stringify(this.loopbackRoute(body));
        const blob = URL.createObjectURL(new Blob([answer], { type: "application/json" }));
        super.open("GET", blob, this.loopbackAsync);
        this.addEventListener("loadend", () => URL.revokeObjectURL(blob));
        super.send();
    }
}

window.XMLHttpRequest = LoopbackXMLHttpRequest;

// The same for fetch(), which main.js, global.js and synthview.js use
const loopbackNativeFetch = window.fetch.bind(window);

window.fetch = function (input, init) {
    const request = input instanceof Request ? input : null;
    const url = request ? request.url : String(input);
    const method = (init && init.method) || (request ? request.method : "GET");
    const route = daemonRoute(method, loopbackPath(url));
    if (route !== null) {
        const answer = JSON.stringify(route(init ? init.body : undefined));
        return Promise.resolve(new Response(answer, { headers: { "Content-Type": "application/json" } }));
    }
    return loopbackNativeFetch(request ? new Request(loopbackUrl(url), request) : loopbackUrl(url), init);
};
