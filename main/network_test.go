/*
	network_test.go: requirements-style unit tests for the NMEA output routing
	(network.go): the full FLARM NMEA capability and the reduced one for a
	9600 baud port, NETWORK_FLARM_NMEA_9600.
*/

package main

import (
	"strings"
	"sync"
	"testing"
	"time"
)

// captureByCapability points the outputs at one connection per capability set and
// returns a function that reads back, per set, the sentence prefixes sent since the
// last call.
func captureByCapability(t *testing.T, caps ...uint8) func() map[uint8][]string {
	t.Helper()
	netMu, conns, loopMap, loopMu := netMutex, clientConnections, avoidLoopBackMap, avoidLoopBackMutex
	t.Cleanup(func() {
		netMutex, clientConnections, avoidLoopBackMap, avoidLoopBackMutex = netMu, conns, loopMap, loopMu
	})
	netMutex, avoidLoopBackMutex, avoidLoopBackMap = &sync.Mutex{}, &sync.Mutex{}, make(map[string]string)
	clientConnections = make(map[string]connection)
	byCap := make(map[uint8]*capConn)
	for _, c := range caps {
		conn := &capConn{captureConn{q: NewMessageQueue(1024)}, c}
		byCap[c] = conn
		clientConnections[string(rune('A'+len(byCap)))] = conn
	}
	return func() map[uint8][]string {
		sent := make(map[uint8][]string)
		for c, conn := range byCap {
			sent[c] = []string{}
			for _, d := range conn.q.GetQueueDump(false) {
				sent[c] = append(sent[c], strings.SplitN(string(d.([]byte)), ",", 2)[0])
			}
			conn.q = NewMessageQueue(1024)
		}
		return sent
	}
}

const bothFlarmNMEA = NETWORK_FLARM_NMEA | NETWORK_FLARM_NMEA_9600

// sendNetFLARM reaches the full and the reduced 9600 FLARM NMEA outputs,
// sendNetFLARMFull only the full ones. A port with both capabilities gets each
// sentence once, and a port with neither gets nothing.
func TestSendNetFLARM9600Routing(t *testing.T) {
	withTrafficState(t)
	sent := captureByCapability(t, NETWORK_FLARM_NMEA, NETWORK_FLARM_NMEA_9600, bothFlarmNMEA, NETWORK_GDL90_STANDARD)

	sendNetFLARM("$GPRMC,kept*00\r\n", 0, 0)
	sendNetFLARMFull("$RBEMS,full only*00\r\n", 0, 0)

	want := map[uint8][]string{
		NETWORK_FLARM_NMEA:      {"$GPRMC", "$RBEMS"},
		NETWORK_FLARM_NMEA_9600: {"$GPRMC"},
		bothFlarmNMEA:           {"$GPRMC", "$RBEMS"},
		NETWORK_GDL90_STANDARD:  {},
	}
	got := sent()
	for c, w := range want {
		if strings.Join(got[c], " ") != strings.Join(w, " ") {
			t.Errorf("capability %d: %v; want %v", c, got[c], w)
		}
	}
}

// $RPYL, 20 Hz from the sensor loop, goes to the full FLARM NMEA outputs only:
// on its own it would use 70 % of a 9600 baud port.
func TestRPYLNotOnFlarmNMEA9600(t *testing.T) {
	withTrafficState(t)
	mySituation.muAttitude = &sync.Mutex{}
	sent := captureByCapability(t, NETWORK_FLARM_NMEA, NETWORK_FLARM_NMEA_9600)
	attitudeAt(-12.34, 5.67, 271.5)
	globalStatus.IMUConnected = true

	makeAHRSLevilReport()

	got := sent()
	if strings.Join(got[NETWORK_FLARM_NMEA], " ") != "$RPYL" {
		t.Errorf("full FLARM NMEA: %v; want [$RPYL]", got[NETWORK_FLARM_NMEA])
	}
	if len(got[NETWORK_FLARM_NMEA_9600]) != 0 {
		t.Errorf("FLARM NMEA 9600: %v; want nothing", got[NETWORK_FLARM_NMEA_9600])
	}
}

// The EMS loop sends $RBEMS at 5 Hz and $RBCYL every tenth tick, both to the full
// FLARM NMEA outputs only: the slave-display sentences stay off a 9600 baud port.
func TestRBEMSAndRBCYLNotOnFlarmNMEA9600(t *testing.T) {
	withTrafficState(t)
	withEMS(t)
	sent := captureByCapability(t, NETWORK_FLARM_NMEA, NETWORK_FLARM_NMEA_9600)
	ems.emsIsSendingData = true
	done := make(chan bool)
	go func() { done <- ems.ListenerFunc() }()
	// 1 s start-up, then $RBCYL on the eleventh 200 ms tick, at about 3 s
	time.Sleep(3400 * time.Millisecond)
	ems.emsIsSendingData = false
	<-done

	got := sent()
	full := " " + strings.Join(got[NETWORK_FLARM_NMEA], " ") + " "
	if !strings.Contains(full, " $RBEMS ") || !strings.Contains(full, " $RBCYL ") {
		t.Errorf("full FLARM NMEA: %v; want $RBEMS and $RBCYL", got[NETWORK_FLARM_NMEA])
	}
	if len(got[NETWORK_FLARM_NMEA_9600]) != 0 {
		t.Errorf("FLARM NMEA 9600: %v; want nothing", got[NETWORK_FLARM_NMEA_9600])
	}
}
