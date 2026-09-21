/**
 * This file is part of RB.
 *
 * Copyright (C) 2026 XIAPROJECTS SRL
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
 * 07 -> Display with Stratux BLE Traffic composed by RB-05 + RB-03 in the same box
 * 08 -> Voice Recognition Box with LLM and Natural speaking and Voice Recorder
 *
 * Community edition will be free for all builders and personal use as defined by the licensing model
 * Dual licensing for commercial agreement is available
 * Please join Discord community
 *
 *
 * Magnetometer addon: the magnetic field vector in 3D, live.
 *
 * The scene is the magnetometer's own frame (X red, Y green, Z blue, Z up on
 * screen). Each situation update adds the current sample to a fading trail
 * and points the arrow at it. Two wireframes give the calibration away at a
 * glance:
 *   green  the stored calibration envelope (the MagMin/MagMax values): in CALIBRATED
 *          mode it is the unit sphere the samples should lie on, in RAW mode
 *          it is the ellipsoid in sensor counts;
 *   yellow the bounds of what has been seen since the plate was opened.
 * A good calibration puts the trail on the green sphere at |m| ~ 1 whatever
 * the attitude; hard iron shows as an off-centre trail, a bad axis scale as
 * an ellipse.
 *
 * CALIBRATE resets the envelope and lets the daemon track min/max
 * (POST /magnetometer with Calibrating:true); STOP & STORE persists what it
 * collected (PUT). The min/max envelope only calibrates the axes the aircraft
 * actually swept: banks and pitch changes are needed for Z. For a proper
 * calibration record a flight and use test/magnetometer_check -flightlog.
 *
 * The toolbar under the view manages the calibration itself:
 *   CONFIG      the live state next to what stratux.conf holds (envelope,
 *               offset, autocalibration, sensor quaternion, reference field);
 *   AUTOCAL     Calibrating on/off without touching the envelope: ON lets the
 *               daemon keep widening it with whatever it sees, OFF freezes it.
 *               Persisted, so it survives a restart;
 *   RESET       two taps: DELETE /magnetometer wipes the envelope (live and
 *               settings), the compass is unusable until calibrated again;
 *   OFFSET FROM GPS TRACK
 *               sets Offset so the magnetic heading reads the current GPS
 *               track. Flying straight and level, no wind: the offset then
 *               absorbs the magnetic declination and any drift too.
 *
 * Uses the Three.js already loaded by index.html (/synthview/three.min.js and
 * OrbitControls.js), so it works with no network.
 */

angular.module('appControllers').controller('MagnetometerCtrl', MagnetometerCtrl);

// Renders the field vector, its trail and the calibration wireframes into a
// container div. Display units: calibrated samples are ~unit length; raw
// samples are divided by a common scale so the picture stays the same size.
function MagnetometerFieldRenderer(containerId) {
    this.container = document.getElementById(containerId);
    this.running = false;
    this.trailMax = 600;
    this.trailCount = 0;
    this.positions = new Float32Array(this.trailMax * 3);
    this.colors = new Float32Array(this.trailMax * 3);
    this.bounds = null; // running min/max of displayed points

    var w = this.container.clientWidth || 300;
    var h = this.container.clientHeight || 300;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x111111);
    // Sensor Z up on screen: Three.js is Y-up, so lay the sensor frame down.
    this.scene.rotation.x = -Math.PI / 2;

    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.01, 100);
    this.camera.position.set(2.6, 2.2, 2.6);

    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h);
    this.container.appendChild(this.renderer.domElement);

    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0, 0);
    this.controls.enablePan = false;

    this.scene.add(new THREE.AxesHelper(1.5));
    var gridXY = new THREE.GridHelper(3, 6, 0x444444, 0x2a2a2a);
    gridXY.rotation.x = Math.PI / 2; // GridHelper lies in Three's XZ; put it in the sensor XY plane
    this.scene.add(gridXY);

    // Trail of recent samples, newest first, fading with age.
    this.trailGeometry = new THREE.BufferGeometry();
    this.trailGeometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.trailGeometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.trailGeometry.setDrawRange(0, 0);
    this.trail = new THREE.Points(this.trailGeometry, new THREE.PointsMaterial({
        size: 0.05, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 0.8
    }));
    this.scene.add(this.trail);

    // Calibration envelope (green) and running bounds (yellow), both unit spheres scaled.
    this.envelope = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), new THREE.MeshBasicMaterial({
        color: 0x44ff44, wireframe: true, transparent: true, opacity: 0.25
    }));
    this.scene.add(this.envelope);
    this.boundsMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), new THREE.MeshBasicMaterial({
        color: 0xffff44, wireframe: true, transparent: true, opacity: 0.2
    }));
    this.boundsMesh.visible = false;
    this.scene.add(this.boundsMesh);

    // The current field vector.
    this.arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 0), 1, 0xff8800, 0.15, 0.08);
    this.scene.add(this.arrow);
    this.marker = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff8800 }));
    this.scene.add(this.marker);

    var self = this;
    this.onResize = function () { self.resize(); };
    window.addEventListener('resize', this.onResize);
}

MagnetometerFieldRenderer.prototype.resize = function () {
    var w = this.container.clientWidth, h = this.container.clientHeight;
    if (w === 0 || h === 0) {
        return;
    }
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
};

// setEnvelope places the green wireframe: centre and semi-axes in display units.
MagnetometerFieldRenderer.prototype.setEnvelope = function (centre, semi) {
    this.envelope.position.set(centre[0], centre[1], centre[2]);
    this.envelope.scale.set(semi[0], semi[1], semi[2]);
};

MagnetometerFieldRenderer.prototype.resetBounds = function () {
    this.bounds = null;
    this.boundsMesh.visible = false;
    this.trailCount = 0;
    this.trailGeometry.setDrawRange(0, 0);
};

// addSample pushes a point (display units) onto the trail and moves the arrow.
MagnetometerFieldRenderer.prototype.addSample = function (x, y, z) {
    var p = this.positions, c = this.colors, n = this.trailMax;
    for (var i = n - 1; i > 0; i--) {
        var i3 = i * 3, j3 = (i - 1) * 3;
        p[i3] = p[j3]; p[i3 + 1] = p[j3 + 1]; p[i3 + 2] = p[j3 + 2];
        c[i3] = c[j3] * 0.985; c[i3 + 1] = c[j3 + 1] * 0.985; c[i3 + 2] = c[j3 + 2] * 0.985;
    }
    p[0] = x; p[1] = y; p[2] = z;
    c[0] = 1.0; c[1] = 0.55; c[2] = 0.1;
    this.trailCount = Math.min(this.trailCount + 1, n);
    this.trailGeometry.attributes.position.needsUpdate = true;
    this.trailGeometry.attributes.color.needsUpdate = true;
    this.trailGeometry.setDrawRange(0, this.trailCount);

    var len = Math.sqrt(x * x + y * y + z * z);
    if (len > 1e-6) {
        this.arrow.setDirection(new THREE.Vector3(x / len, y / len, z / len));
        this.arrow.setLength(len, Math.min(0.15, len * 0.3), Math.min(0.08, len * 0.15));
    }
    this.marker.position.set(x, y, z);

    if (this.bounds === null) {
        this.bounds = [x, x, y, y, z, z];
    } else {
        var b = this.bounds;
        b[0] = Math.min(b[0], x); b[1] = Math.max(b[1], x);
        b[2] = Math.min(b[2], y); b[3] = Math.max(b[3], y);
        b[4] = Math.min(b[4], z); b[5] = Math.max(b[5], z);
    }
    var b = this.bounds;
    var sx = (b[1] - b[0]) / 2, sy = (b[3] - b[2]) / 2, sz = (b[5] - b[4]) / 2;
    if (sx > 0.01 && sy > 0.01 && sz > 0.01) {
        this.boundsMesh.position.set((b[0] + b[1]) / 2, (b[2] + b[3]) / 2, (b[4] + b[5]) / 2);
        this.boundsMesh.scale.set(sx, sy, sz);
        this.boundsMesh.visible = true;
    }
};

MagnetometerFieldRenderer.prototype.start = function () {
    if (this.running) {
        return;
    }
    this.running = true;
    var self = this;
    function frame() {
        if (!self.running) {
            return;
        }
        self.controls.update();
        self.renderer.render(self.scene, self.camera);
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
};

// dispose stops rendering and frees the WebGL context: the plate is entered
// and left many times in a flight and contexts are a scarce resource.
MagnetometerFieldRenderer.prototype.dispose = function () {
    this.running = false;
    window.removeEventListener('resize', this.onResize);
    this.controls.dispose();
    this.trailGeometry.dispose();
    this.envelope.geometry.dispose();
    this.boundsMesh.geometry.dispose();
    this.marker.geometry.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) {
        this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
};

function MagnetometerCtrl($rootScope, $scope, $state, $http) {

    const name = "magnetometer";
    const controllerName = String(name).charAt(0).toLocaleUpperCase() + String(name).slice(1) + "Ctrl";

    $state.get(name).onEnter = function () {
        console.log("onEnter" + name);
    };

    $state.get(name).onExit = function () {
        console.log("onExit" + name);
        removeEventListener("SituationUpdated", situationUpdateEventListener);
        clearTimeout(confirmResetTimer);
        if ($scope.renderer3d !== null) {
            $scope.renderer3d.dispose();
            $scope.renderer3d = null;
        }
    };

    console.log("Controller " + name);

    $scope.items = {
        heading: "---",
        offset: 0,
        rawX: 0, rawY: 0, rawZ: 0,
        calX: "-", calY: "-", calZ: "-",
        magnitude: "-",
        envX: "-", envY: "-", envZ: "-",
        calibrating: false,
        calibratedMode: true,
        showConfig: false,
        config: "",
        confirmReset: false,
        hint: "waiting for the magnetometer"
    };
    $scope.renderer3d = null;
    $scope.lastMag = null;  // last Magnetometer object from the situation feed
    $scope.lastSituation = null;
    var lastApply = 0;
    var noticeUntil = 0;  // the hint holds a button's outcome until then
    var confirmResetTimer = null;

    // notify shows text in the hint line for a few seconds, over the
    // status the situation listener would otherwise write there.
    function notify(text) {
        $scope.items.hint = text;
        noticeUntil = Date.now() + 4000;
        $scope.$applyAsync();
    }

    // The daemon marks a fresh envelope with these sentinels (CalibrationReset).
    function envelopeValid(m) {
        return m.MagMaxX > m.MagMinX && m.MagMaxY > m.MagMinY && m.MagMaxZ > m.MagMinZ
            && Math.abs(m.MagMaxX) < 90000 && Math.abs(m.MagMinX) < 90000
            && Math.abs(m.MagMaxZ) < 90000 && Math.abs(m.MagMinZ) < 90000;
    }

    // calibrate applies the envelope the way main/magnetometer.go does:
    // (raw - centre) / semi-range per axis.
    function calibrate(m) {
        var cx = (m.MagMinX + m.MagMaxX) / 2, cy = (m.MagMinY + m.MagMaxY) / 2, cz = (m.MagMinZ + m.MagMaxZ) / 2;
        var sx = (m.MagMaxX - m.MagMinX) / 2, sy = (m.MagMaxY - m.MagMinY) / 2, sz = (m.MagMaxZ - m.MagMinZ) / 2;
        return { x: (m.X - cx) / sx, y: (m.Y - cy) / sy, z: (m.Z - cz) / sz, cx: cx, cy: cy, cz: cz, sx: sx, sy: sy, sz: sz };
    }

    $scope.rawScale = 1;  // display units per count in RAW mode, from the envelope or the data

    function situationUpdateEventListener(event) {
        if (($scope === undefined) || ($scope === null) || $state.current.controller != controllerName) {
            removeEventListener("SituationUpdated", situationUpdateEventListener);
            return; // we are getting called once after clicking away from the page
        }
        var situation = event.detail;
        $scope.lastSituation = situation;
        var m = situation["Magnetometer"];
        if (m === undefined || m === null) {
            return;
        }
        $scope.lastMag = m;

        if ($scope.renderer3d === null) {
            if (document.getElementById("magnetometer3d") === null) {
                return; // template not in the DOM yet
            }
            $scope.renderer3d = new MagnetometerFieldRenderer("magnetometer3d");
            $scope.renderer3d.start();
        }
        var r = $scope.renderer3d;
        var valid = envelopeValid(m);
        var cal = valid ? calibrate(m) : null;

        if ($scope.items.calibratedMode && valid) {
            r.addSample(cal.x, cal.y, cal.z);
            r.setEnvelope([0, 0, 0], [1, 1, 1]);
        } else {
            // RAW: one common scale so the plot stays about unit size.
            var scale = valid ? Math.max(cal.sx, cal.sy, cal.sz) : Math.max(Math.abs(m.X), Math.abs(m.Y), Math.abs(m.Z), 1);
            $scope.rawScale = Math.max($scope.rawScale, scale);
            var s = $scope.rawScale;
            r.addSample(m.X / s, m.Y / s, m.Z / s);
            if (valid) {
                r.setEnvelope([cal.cx / s, cal.cy / s, cal.cz / s], [cal.sx / s, cal.sy / s, cal.sz / s]);
            } else {
                r.setEnvelope([0, 0, 0], [0, 0, 0]);
            }
        }

        // Text at 4 Hz is plenty and keeps the digest cheap on the Pi.
        var now = Date.now();
        if (now - lastApply < 250) {
            return;
        }
        lastApply = now;
        var hdg = situation["AHRSMagHeading"];
        $scope.items.heading = (hdg !== undefined && Math.abs(hdg - 3276.7) > 0.01) ? hdg.toFixed(0) : "---";
        $scope.items.offset = m.Offset;
        $scope.items.rawX = m.X.toFixed(0);
        $scope.items.rawY = m.Y.toFixed(0);
        $scope.items.rawZ = m.Z.toFixed(0);
        $scope.items.calibrating = m.Calibrating;
        if (valid) {
            $scope.items.calX = cal.x.toFixed(2);
            $scope.items.calY = cal.y.toFixed(2);
            $scope.items.calZ = cal.z.toFixed(2);
            $scope.items.magnitude = Math.sqrt(cal.x * cal.x + cal.y * cal.y + cal.z * cal.z).toFixed(2);
            $scope.items.envX = m.MagMinX.toFixed(0) + " .. " + m.MagMaxX.toFixed(0);
            $scope.items.envY = m.MagMinY.toFixed(0) + " .. " + m.MagMaxY.toFixed(0);
            $scope.items.envZ = m.MagMinZ.toFixed(0) + " .. " + m.MagMaxZ.toFixed(0);
        } else {
            $scope.items.calX = $scope.items.calY = $scope.items.calZ = "-";
            $scope.items.magnitude = "-";
            $scope.items.envX = $scope.items.envY = $scope.items.envZ = "not calibrated";
        }
        if (now < noticeUntil) {
            // keep the button's outcome on screen
        } else if (m.Calibrating) {
            $scope.items.hint = "calibrating: turn through 360°, then pitch and bank so Z sweeps too";
        } else if (!valid) {
            $scope.items.hint = "no calibration envelope: press CALIBRATE";
        } else if ($scope.items.calibratedMode) {
            $scope.items.hint = "good calibration: trail on the green sphere, |m| near 1.00 at any attitude";
        } else {
            $scope.items.hint = "raw counts; green = stored envelope, yellow = seen since opening";
        }
        $scope.$applyAsync();
    }

    $scope.toggleMode = function () {
        $scope.items.calibratedMode = !$scope.items.calibratedMode;
        $scope.rawScale = 1;
        if ($scope.renderer3d !== null) {
            $scope.renderer3d.resetBounds();
        }
    };

    // calibrationMessage is the /magnetometer body for the live state m with
    // the fields in changes replaced.
    function calibrationMessage(m, changes) {
        var msg = {
            MagMaxX: m.MagMaxX, MagMaxY: m.MagMaxY, MagMaxZ: m.MagMaxZ,
            MagMinX: m.MagMinX, MagMinY: m.MagMinY, MagMinZ: m.MagMinZ,
            X: m.X, Y: m.Y, Z: m.Z, Heading: 0, Offset: m.Offset, Calibrating: m.Calibrating
        };
        for (var k in changes) {
            msg[k] = changes[k];
        }
        return msg;
    }

    // storeCalibration persists msg: PUT writes settings, POST applies it to
    // the live state (both are needed). The hint then shows done, or which
    // action (what) failed.
    function storeCalibration(msg, what, done) {
        var body = JSON.stringify(msg);
        $http.put("/magnetometer", body).then(function () {
            return $http.post("/magnetometer", body);
        }).then(function () {
            if (done) {
                notify(done);
            }
        }, function (response) {
            console.log("magnetometer " + what + " failed", response.status);
            notify(what + " failed: HTTP " + response.status);
        });
    }

    // CALIBRATE: reset the envelope and let the daemon track min/max.
    // STOP & STORE: persist what was collected.
    $scope.toggleCalibration = function () {
        var m = $scope.lastMag;
        if (m === null) {
            return;
        }
        if (!m.Calibrating) {
            var msg = calibrationMessage(m, {
                MagMaxX: -99999, MagMaxY: -99999, MagMaxZ: -99999,
                MagMinX: 99999, MagMinY: 99999, MagMinZ: 99999,
                Calibrating: true
            });
            $http.post("/magnetometer", JSON.stringify(msg)).then(function () {
                if ($scope.renderer3d !== null) {
                    $scope.renderer3d.resetBounds();
                }
            }, function (response) {
                console.log("magnetometer calibrate failed", response.status);
            });
        } else {
            storeCalibration(calibrationMessage(m, { Calibrating: false }), "store", "envelope stored");
        }
    };

    // AUTOCAL ON/OFF: flip Calibrating and keep the envelope, unlike
    // CALIBRATE which starts it over. Persisted so it survives a restart.
    $scope.toggleAutoCalibration = function () {
        var m = $scope.lastMag;
        if (m === null) {
            return;
        }
        var on = !m.Calibrating;
        storeCalibration(calibrationMessage(m, { Calibrating: on }), "autocal",
            on ? "autocalibration on: the envelope grows with what the sensor sees"
                : "autocalibration off: envelope frozen and stored");
    };

    // RESET: a second tap within 3 s wipes the envelope in the daemon
    // (DELETE resets both the live state and the settings copy).
    $scope.resetCalibration = function () {
        if (!$scope.items.confirmReset) {
            $scope.items.confirmReset = true;
            confirmResetTimer = setTimeout(function () {
                $scope.items.confirmReset = false;
                $scope.$applyAsync();
            }, 3000);
            return;
        }
        clearTimeout(confirmResetTimer);
        $scope.items.confirmReset = false;
        $http.delete("/magnetometer").then(function () {
            if ($scope.renderer3d !== null) {
                $scope.renderer3d.resetBounds();
            }
            notify("calibration reset: CALIBRATE or AUTOCAL ON to collect a new envelope");
        }, function (response) {
            console.log("magnetometer reset failed", response.status);
            notify("reset failed: HTTP " + response.status);
        });
    };

    // normalizeOffset folds an angle into -180..180 for a readable offset.
    function normalizeOffset(a) {
        return ((a % 360) + 540) % 360 - 180;
    }

    // OFFSET FROM GPS TRACK: move Offset by the difference between the GPS
    // track and the magnetic heading, so the compass reads the track now.
    // Needs a fix and some ground speed for the track to mean anything.
    $scope.applyGpsTrackOffset = function () {
        var m = $scope.lastMag, s = $scope.lastSituation;
        if (m === null || s === null) {
            return;
        }
        var hdg = s.AHRSMagHeading, trk = s.GPSTrueCourse;
        if (!(s.GPSFixQuality > 0) || !(s.GPSGroundSpeed > 5) || trk === undefined) {
            notify("no GPS track: needs a fix and more than 5 kt, flying straight");
            return;
        }
        if (hdg === undefined || Math.abs(hdg - 3276.7) < 0.01) {
            notify("no magnetic heading to align");
            return;
        }
        var offset = normalizeOffset(m.Offset + normalizeOffset(trk - hdg));
        offset = Math.round(offset * 10) / 10;
        storeCalibration(calibrationMessage(m, { Offset: offset }), "offset",
            "offset " + offset + "°: heading " + hdg.toFixed(0) + "° aligned to GPS track " + trk.toFixed(0) + "°");
    };

    // CONFIG: the live state next to the stored calibration, as a snapshot.
    function envelopeText(m) {
        if (!envelopeValid(m)) {
            return "  envelope    not calibrated\n";
        }
        var t = "";
        ["X", "Y", "Z"].forEach(function (axis) {
            var lo = m["MagMin" + axis].toFixed(0), hi = m["MagMax" + axis].toFixed(0);
            t += "  " + axis + " " + ("      " + lo).slice(-7) + " .. " + ("      " + hi).slice(-7) + "\n";
        });
        return t;
    }

    function configText(live, stored, settings) {
        var t = "";
        if (live === null) {
            t += "LIVE        no magnetometer data yet\n";
        } else {
            t += "LIVE        autocal " + (live.Calibrating ? "ON" : "OFF") + "   offset " + live.Offset + "\n";
            t += envelopeText(live);
        }
        t += "STORED      autocal " + (stored.Calibrating ? "ON" : "OFF") + "   offset " + stored.Offset + "\n";
        t += envelopeText(stored);
        var q = settings.MagSensorQuaternion || [0, 0, 0, 0];
        var set = q.some(function (v) { return v !== 0; });
        t += "  quaternion  " + (set ? q.map(function (v) { return v.toFixed(3); }).join(" ") : "not set, derived at the next cage") + "\n";
        t += "  field/dip   " + (settings.MagField ? settings.MagField + " uT" : "dipole") + " / " + (settings.MagDip ? settings.MagDip + "°" : "dipole") + "\n";
        return t;
    }

    $scope.toggleConfig = function () {
        if ($scope.items.showConfig) {
            $scope.items.showConfig = false;
            return;
        }
        $scope.items.config = "loading";
        $scope.items.showConfig = true;
        $http.get("/getSettings").then(function (response) {
            var settings = response.data || {};
            $scope.items.config = configText($scope.lastMag, settings.MagCalibration || {}, settings);
        }, function (response) {
            $scope.items.config = "GET /getSettings failed: HTTP " + response.status;
        });
    };

    addEventListener("SituationUpdated", situationUpdateEventListener);
};
