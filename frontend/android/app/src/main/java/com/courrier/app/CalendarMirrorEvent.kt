package com.courrier.app

import android.provider.CalendarContract.Attendees
import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset

data class CalendarMirrorAttendee(val name: String, val email: String, val organizer: Boolean, val status: Int) {
    companion object {
        fun parse(json: JSONObject) = CalendarMirrorAttendee(
            json.optString("name", ""), json.getString("email"), json.optBoolean("isOrganizer", false),
            responseStatus(json.optString("status")))

        fun responseStatus(status: String): Int = when (status) {
                "ACCEPTED" -> Attendees.ATTENDEE_STATUS_ACCEPTED
                "DECLINED" -> Attendees.ATTENDEE_STATUS_DECLINED
                "TENTATIVE" -> Attendees.ATTENDEE_STATUS_TENTATIVE
                "NEEDS-ACTION" -> Attendees.ATTENDEE_STATUS_INVITED
                else -> Attendees.ATTENDEE_STATUS_NONE
            }
    }
}

data class CalendarMirrorEvent(
    val id: String, val title: String, val start: Long, val end: Long,
    val allDay: Boolean, val location: String, val description: String,
    val attendees: List<CalendarMirrorAttendee>,
    val selfStatus: Int,
) {
    // Android derives SELF_ATTENDEE_STATUS from this owner's attendee row and rejects
    // direct updates to that event column. Normalize casing for its exact email comparison.
    fun attendeesForOwner(owner: String): List<CalendarMirrorAttendee> {
        val own = attendees.firstOrNull { it.email.equals(owner, ignoreCase = true) }
        return attendees.filterNot { it.email.equals(owner, ignoreCase = true) } +
            (own?.copy(email = owner, status = selfStatus)
                ?: CalendarMirrorAttendee(owner, owner, false, selfStatus))
    }

    companion object {
        fun parse(json: JSONObject, zone: ZoneId = ZoneId.systemDefault()): CalendarMirrorEvent {
            val id = json.getString("id")
            require(id.isNotBlank()) { "Invalid event identifier" }
            val allDay = json.getBoolean("isAllday")
            fun timestamp(value: String): Long = if (allDay) {
                // Android requires UTC midnight for floating all-day dates, with an exclusive end.
                LocalDate.parse(value.take(10)).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
            } else {
                try { OffsetDateTime.parse(value).toInstant().toEpochMilli() }
                catch (_: java.time.format.DateTimeParseException) {
                    LocalDateTime.parse(value).atZone(zone).toInstant().toEpochMilli()
                }
            }
            val start = timestamp(json.getString("start"))
            val end = timestamp(json.getString("end"))
            require(end >= start) { "Invalid event interval" }
            return CalendarMirrorEvent(id, json.getString("title"), start,
                if (allDay && end == start) start + 86_400_000 else end,
                allDay, json.optString("location", ""), json.optString("description", ""),
                json.optJSONArray("attendees")?.let { array ->
                    (0 until array.length()).map { CalendarMirrorAttendee.parse(array.getJSONObject(it)) }
                }.orEmpty(), CalendarMirrorAttendee.responseStatus(json.optString("selfRsvpStatus")))
        }
    }
}
