/*
	alertslog_test.go: requirements-style unit tests for the alerts written to the
	flight log (logAlertEvent in alerts.go, the alerts table in datalog.go).

	The flight log keeps what the pilot was shown: one row when an alert is raised
	and one for every change of Active, so the cloud can rebuild the alert table of
	a flight without re-running the rules. The moves of the end of an alert that
	stays active are not written, the close row carries the end.

	The first tests read the rows from dataLogChan, where the daemon queues them for
	the writer. The last one writes them into a real SQLite file the way the writer
	does, because Alert itself could not be a table: its Id clashes with the id
	primary key, SQLite column names ignore case.
*/

package main

import (
	"database/sql"
	"path/filepath"
	"testing"
	"time"
)

// withFlightLog makes the log functions queue their rows in a channel the test reads,
// as if the replay log were on and open, and puts the globals back afterwards.
func withFlightLog(t *testing.T, replayLog bool) chan DataLogRow {
	savedChan, savedReady, savedReplay := dataLogChan, dataLogReadyToWrite, globalSettings.ReplayLog
	t.Cleanup(func() {
		dataLogChan, dataLogReadyToWrite, globalSettings.ReplayLog = savedChan, savedReady, savedReplay
	})
	dataLogChan = make(chan DataLogRow, 64)
	dataLogReadyToWrite = true
	globalSettings.ReplayLog = replayLog
	return dataLogChan
}

// alertRows drains the alert rows queued so far.
func alertRows(t *testing.T, ch chan DataLogRow) (rows []AlertDataLogger) {
	t.Helper()
	for {
		select {
		case r := <-ch:
			if r.tbl != "alerts" {
				t.Fatalf("row queued for table %q, want alerts", r.tbl)
			}
			rows = append(rows, r.data.(AlertDataLogger))
		default:
			return rows
		}
	}
}

// A raised alert is written once, with what the display was sent.
func TestARaisedAlertIsWrittenToTheFlightLog(t *testing.T) {
	withAlerts(t)
	ch := withFlightLog(t, true)
	raised := time.Date(2026, time.November, 21, 11, 50, 12, 340000000, time.UTC)
	id := alerts.pushEvent(Alert{Type: EVENT_TYPE_EMS_RULE_YELLOW, Title: "CHTMAX yellow 210", Timestamp: raised, Active: true})

	rows := alertRows(t, ch)
	if len(rows) != 1 {
		t.Fatalf("%d rows written, want 1: %+v", len(rows), rows)
	}
	r := rows[0]
	if r.Event != ALERT_LOG_RAISE || r.AlertId != id || r.Type != EVENT_TYPE_EMS_RULE_YELLOW ||
		r.Title != "CHTMAX yellow 210" || !r.Active || !r.Timestamp.Equal(raised) || !r.TimestampEnd.Equal(raised) {
		t.Errorf("row %+v does not match the raised alert %d", r, id)
	}
	if r.Clock.IsZero() {
		t.Error("the row has no write time")
	}
}

// A one-shot event is written as a raise with Active false, and nothing more.
func TestAOneShotEventIsWrittenAsAnInactiveRaise(t *testing.T) {
	withAlerts(t)
	ch := withFlightLog(t, true)
	alerts.pushEvent(Alert{Type: EVENT_TYPE_TIMER, Title: "Timer 1 fired", Timestamp: time.Now()})

	rows := alertRows(t, ch)
	if len(rows) != 1 || rows[0].Event != ALERT_LOG_RAISE || rows[0].Active {
		t.Fatalf("rows %+v, want one inactive raise", rows)
	}
}

// Only the changes of Active are written: staying active, or staying closed, writes
// nothing. The close carries the end, and a reopen keeps the Id of the raise.
func TestOnlyTheChangesOfActiveAreWrittenToTheFlightLog(t *testing.T) {
	withAlerts(t)
	ch := withFlightLog(t, true)
	id := alerts.pushEvent(Alert{Type: EVENT_TYPE_GPS_NOT_FIXED, Title: "GPS fix lost", Timestamp: time.Now(), Active: true})
	alertRows(t, ch) // the raise

	alerts.pushEvent(Alert{Id: id, Active: true}) // still lost: the end moves
	if rows := alertRows(t, ch); len(rows) != 0 {
		t.Fatalf("an alert staying active wrote %+v", rows)
	}

	alerts.pushEvent(Alert{Id: id, Active: false})
	rows := alertRows(t, ch)
	if len(rows) != 1 || rows[0].Event != ALERT_LOG_CLOSE || rows[0].AlertId != id || rows[0].Active {
		t.Fatalf("close wrote %+v", rows)
	}
	if rows[0].TimestampEnd.Before(rows[0].Timestamp) || rows[0].TimestampEnd.Equal(rows[0].Timestamp) {
		t.Errorf("the close row ends at %v, not after the raise at %v", rows[0].TimestampEnd, rows[0].Timestamp)
	}
	if rows[0].Title != "GPS fix lost" || rows[0].Type != EVENT_TYPE_GPS_NOT_FIXED {
		t.Errorf("the close row lost the alert's title or type: %+v", rows[0])
	}

	alerts.pushEvent(Alert{Id: id, Active: false}) // closed staying closed
	if rows := alertRows(t, ch); len(rows) != 0 {
		t.Fatalf("an alert staying closed wrote %+v", rows)
	}

	alerts.pushEvent(Alert{Id: id, Active: true})
	rows = alertRows(t, ch)
	if len(rows) != 1 || rows[0].Event != ALERT_LOG_REOPEN || rows[0].AlertId != id || !rows[0].Active {
		t.Fatalf("reopen wrote %+v", rows)
	}
}

// An update of an alert that is not in the list writes nothing.
func TestAnUpdateOfAnUnknownAlertIsNotWritten(t *testing.T) {
	withAlerts(t)
	ch := withFlightLog(t, true)
	if id := alerts.pushEvent(Alert{Id: 123456, Active: false}); id != -1 {
		t.Fatalf("update of an unknown alert returned %d", id)
	}
	if rows := alertRows(t, ch); len(rows) != 0 {
		t.Fatalf("wrote %+v", rows)
	}
}

// With the replay log off nothing is queued, as for every other table.
func TestNoAlertIsWrittenWithTheReplayLogOff(t *testing.T) {
	withAlerts(t)
	ch := withFlightLog(t, false)
	id := alerts.pushEvent(Alert{Type: EVENT_TYPE_GPS_NOT_FIXED, Title: "GPS fix lost", Timestamp: time.Now(), Active: true})
	alerts.pushEvent(Alert{Id: id, Active: false})
	if len(ch) != 0 {
		t.Fatalf("%d rows queued with the replay log off", len(ch))
	}
}

// The alerts table is created with the others and takes the rows the writer inserts.
func TestTheAlertsTableHoldsTheRowsOfTheFlightLog(t *testing.T) {
	savedTs, savedCur, savedIns, savedBatch, savedStartup := dataLogTimestamps, dataLogCurTimestamp, insertString, insertBatchIfs, stratuxStartupID
	t.Cleanup(func() {
		dataLogTimestamps, dataLogCurTimestamp, insertString, insertBatchIfs, stratuxStartupID = savedTs, savedCur, savedIns, savedBatch, savedStartup
	})
	db, err := sql.Open("sqlite3", filepath.Join(t.TempDir(), "flightlog-test.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	makeTable(StratuxTimestamp{}, "timestamp", db)
	makeTable(AlertDataLogger{}, "alerts", db)
	insertString = make(map[string]string)
	insertBatchIfs = make(map[string][][]interface{})
	dataLogTimestamps = []StratuxTimestamp{{PreferredTime_value: time.Now()}}
	dataLogCurTimestamp = 0
	stratuxStartupID = 1

	raised := time.Date(2026, time.November, 21, 11, 50, 12, 340000000, time.UTC)
	insertData(AlertDataLogger{Clock: raised, Event: ALERT_LOG_RAISE, AlertId: 11501234, Type: EVENT_TYPE_EMS_RULE_RED,
		Title: "EGTDIFF red 74", Active: true, Timestamp: raised, TimestampEnd: raised}, "alerts", db, 0)
	insertData(AlertDataLogger{Clock: raised.Add(9 * time.Second), Event: ALERT_LOG_CLOSE, AlertId: 11501234, Type: EVENT_TYPE_EMS_RULE_RED,
		Title: "EGTDIFF red 74", Timestamp: raised, TimestampEnd: raised.Add(8 * time.Second), ActiveSeconds: 8}, "alerts", db, 0)
	if _, err := bulkInsert("alerts", db); err != nil {
		t.Fatal(err)
	}

	rows, err := db.Query("SELECT Event, AlertId, Type, Title, Active, ActiveSeconds, TimestampEnd, timestamp_id FROM alerts ORDER BY id")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	type row struct {
		event, title, end string
		alertId, typ, ts  int
		active            bool
		seconds           float64
	}
	var got []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.event, &r.alertId, &r.typ, &r.title, &r.active, &r.seconds, &r.end, &r.ts); err != nil {
			t.Fatal(err)
		}
		got = append(got, r)
	}
	if len(got) != 2 {
		t.Fatalf("%d rows in the alerts table, want 2", len(got))
	}
	if got[0].event != "raise" || got[0].alertId != 11501234 || got[0].typ != EVENT_TYPE_EMS_RULE_RED || got[0].title != "EGTDIFF red 74" || !got[0].active {
		t.Errorf("raise row %+v", got[0])
	}
	if got[1].event != "close" || got[1].active || got[1].seconds != 8 || got[1].end != raised.Add(8*time.Second).String() {
		t.Errorf("close row %+v", got[1])
	}
	if got[0].ts == 0 || got[0].ts != got[1].ts {
		t.Errorf("rows not linked to the timestamp table: %d, %d", got[0].ts, got[1].ts)
	}
}
