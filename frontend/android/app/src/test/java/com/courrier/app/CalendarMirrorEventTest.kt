package com.courrier.app

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant
import java.time.ZoneId

class CalendarMirrorEventTest {
    private fun event(start: String, end: String, allDay: Boolean = false) = JSONObject()
        .put("id", "occurrence-1").put("title", "Meeting").put("start", start).put("end", end).put("isAllday", allDay)

    @Test fun ownerAttendeeDrivesTheAndroidRsvpWithoutChangingOtherGuests() {
        for ((status, expected) in listOf("ACCEPTED" to 1, "DECLINED" to 2, "TENTATIVE" to 4, "NEEDS-ACTION" to 3, "" to 0)) {
            val json = event("2026-10-25T09:00:00Z", "2026-10-25T10:00:00Z").put("selfRsvpStatus", status)
                .put("attendees", org.json.JSONArray()
                    .put(JSONObject().put("email", "ME@example.test").put("name", "Me").put("status", "ACCEPTED"))
                    .put(JSONObject().put("email", "guest@example.test").put("status", "TENTATIVE")))
            val rows = CalendarMirrorEvent.parse(json).attendeesForOwner("me@example.test")
            assertEquals(2, rows.size)
            assertEquals(expected, rows.last().status)
            assertEquals("me@example.test", rows.last().email)
            assertEquals("Me", rows.last().name)
            assertEquals(4, rows.first().status)
        }
        val missing = CalendarMirrorEvent.parse(event("2026-10-25T09:00:00Z", "2026-10-25T10:00:00Z").put("selfRsvpStatus", "DECLINED"))
        assertEquals(2, missing.attendeesForOwner("me@example.test").single().status)
    }
    @Test fun viewerResponseIsIndependentOfGuestResponses() {
        for ((status, expected) in listOf("ACCEPTED" to 1, "DECLINED" to 2, "TENTATIVE" to 4, "NEEDS-ACTION" to 3, "DELEGATED" to 0, "" to 0)) {
            val json = event("2026-10-25T09:00:00Z", "2026-10-25T10:00:00Z")
                .put("selfRsvpStatus", status)
                .put("attendees", org.json.JSONArray().put(JSONObject()
                    .put("email", "guest@example.test").put("status", "DECLINED")))
            assertEquals(expected, CalendarMirrorEvent.parse(json).selfStatus)
        }
        assertEquals(0, CalendarMirrorEvent.parse(event("2026-10-25T09:00:00Z", "2026-10-25T10:00:00Z")).selfStatus)
    }
    @Test fun attendeesPreserveIdentityOrganizerAndResponses() {
        val json = event("2026-10-25T09:00:00Z", "2026-10-25T10:00:00Z")
        val guests = org.json.JSONArray()
        for (status in listOf("ACCEPTED", "DECLINED", "TENTATIVE", "NEEDS-ACTION", "DELEGATED")) {
            guests.put(JSONObject().put("name", status).put("email", "$status@example.test")
                .put("status", status).put("isOrganizer", status == "ACCEPTED"))
        }
        val parsed = CalendarMirrorEvent.parse(json.put("attendees", guests))
        assertEquals(listOf(1, 2, 4, 3, 0), parsed.attendees.map { it.status })
        assertTrue(parsed.attendees.first().organizer)
        assertFalse(parsed.attendees.last().organizer)
        assertEquals("ACCEPTED@example.test", parsed.attendees.first().email)
        assertEquals("ACCEPTED", parsed.attendees.first().name)
        assertTrue(CalendarMirrorEvent.parse(json.put("attendees", org.json.JSONArray())).attendees.isEmpty())
        assertTrue(CalendarMirrorEvent.parse(event("2026-10-25T09:00:00Z", "2026-10-25T10:00:00Z")).attendees.isEmpty())
    }
    @Test fun allDayDatesStayAtUtcMidnightAcrossTimeZones() {
        for (zone in listOf("Europe/Paris", "America/Los_Angeles", "Pacific/Auckland")) {
            val parsed = CalendarMirrorEvent.parse(event("2026-10-25T00:00:00", "2026-10-26T00:00:00", true), ZoneId.of(zone))
            assertEquals(Instant.parse("2026-10-25T00:00:00Z").toEpochMilli(), parsed.start)
            assertEquals(86_400_000L, parsed.end - parsed.start)
        }
    }
    @Test fun timedEventsRespectExplicitOffset() {
        val parsed = CalendarMirrorEvent.parse(event("2026-10-25T09:00:00+01:00", "2026-10-25T10:00:00+01:00"), ZoneId.of("America/New_York"))
        assertEquals(Instant.parse("2026-10-25T08:00:00Z").toEpochMilli(), parsed.start)
        assertEquals(3_600_000L, parsed.end - parsed.start)
    }
    @Test fun floatingTimesUseDeviceZone() {
        val parsed = CalendarMirrorEvent.parse(event("2026-10-25T09:00:00", "2026-10-25T10:00:00"), ZoneId.of("Europe/Paris"))
        assertEquals(Instant.parse("2026-10-25T08:00:00Z").toEpochMilli(), parsed.start)
    }
    @Test(expected = IllegalArgumentException::class) fun malformedIntervalsRejectTheSnapshot() {
        CalendarMirrorEvent.parse(event("2026-10-25T10:00:00Z", "2026-10-25T09:00:00Z"))
    }
}
