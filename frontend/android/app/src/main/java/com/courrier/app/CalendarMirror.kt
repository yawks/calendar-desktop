package com.courrier.app

import android.content.ContentProviderOperation
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.graphics.Color
import android.net.Uri
import android.provider.CalendarContract
import android.provider.CalendarContract.Calendars
import android.provider.CalendarContract.Events
import android.provider.CalendarContract.Attendees
import org.json.JSONArray
import java.util.TimeZone

/** Only the local account owned by this bridge is ever queried or modified. */
class CalendarMirror(private val context: Context) {
    private val resolver = context.contentResolver
    private val account = "Courrier"
    private fun syncUri(uri: Uri) = uri.buildUpon()
        .appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER, "true")
        .appendQueryParameter(Calendars.ACCOUNT_NAME, account)
        .appendQueryParameter(Calendars.ACCOUNT_TYPE, CalendarContract.ACCOUNT_TYPE_LOCAL).build()

    fun publish(input: JSONArray) {
        // Validate every snapshot before deleting or replacing any data.
        val desired = (0 until input.length()).map { index ->
            val json = input.getJSONObject(index)
            val id = json.getString("id")
            require(id.isNotBlank()) { "Invalid calendar identifier" }
            Color.parseColor(json.getString("color"))
            json.getString("name")
            val events = json.optJSONArray("events")?.let { array ->
                (0 until array.length()).map { CalendarMirrorEvent.parse(array.getJSONObject(it)) }.also { rows ->
                    require(rows.map { it.id }.distinct().size == rows.size) { "Duplicate event identifier" }
                }
            }
            Triple(json, id, events)
        }
        require(desired.map { it.second }.distinct().size == desired.size) { "Duplicate calendar identifier" }
        val owned = mutableMapOf<String, Long>()
        resolver.query(syncUri(Calendars.CONTENT_URI), arrayOf(Calendars._ID, Calendars._SYNC_ID),
            "${Calendars.ACCOUNT_NAME}=? AND ${Calendars.ACCOUNT_TYPE}=? AND ${Calendars.CAL_SYNC1}=?",
            arrayOf(account, CalendarContract.ACCOUNT_TYPE_LOCAL, context.packageName), null)?.use { cursor ->
            while (cursor.moveToNext()) owned[cursor.getString(1)] = cursor.getLong(0)
        } ?: error("Calendar storage unavailable")
        val selected = desired.map { it.second }.toSet()
        for ((sourceId, nativeId) in owned) {
            if (sourceId !in selected) resolver.delete(syncUri(ContentUris.withAppendedId(Calendars.CONTENT_URI, nativeId)), null, null)
        }
        for ((json, sourceId, events) in desired) {
            val values = ContentValues().apply {
                put(Calendars.NAME, sourceId)
                put(Calendars.OWNER_ACCOUNT, json.optString("ownerEmail").trim().ifEmpty { account })
                put(Calendars.CALENDAR_DISPLAY_NAME, json.getString("name"))
                put(Calendars.CALENDAR_COLOR, Color.parseColor(json.getString("color")))
                put(Calendars.CALENDAR_ACCESS_LEVEL, Calendars.CAL_ACCESS_READ)
                put(Calendars.CAN_ORGANIZER_RESPOND, 0)
                put(Calendars.MAX_REMINDERS, 0)
                put(Calendars.ALLOWED_REMINDERS, "")
            }
            val nativeId = owned[sourceId]?.also { id ->
                resolver.update(syncUri(ContentUris.withAppendedId(Calendars.CONTENT_URI, id)), values, null, null)
            } ?: run {
                values.put(Calendars.ACCOUNT_NAME, account)
                values.put(Calendars.ACCOUNT_TYPE, CalendarContract.ACCOUNT_TYPE_LOCAL)
                values.put(Calendars._SYNC_ID, sourceId)
                values.put(Calendars.CAL_SYNC1, context.packageName)
                values.put(Calendars.VISIBLE, 1)
                values.put(Calendars.SYNC_EVENTS, 1)
                values.put(Calendars.CALENDAR_TIME_ZONE, TimeZone.getDefault().id)
                ContentUris.parseId(resolver.insert(syncUri(Calendars.CONTENT_URI), values) ?: error("Calendar creation failed"))
            }
            // Absent events means unavailable, while [] is a successful empty snapshot.
            if (events != null) publishEvents(nativeId, events, values.getAsString(Calendars.OWNER_ACCOUNT))
        }
    }

    private fun publishEvents(calendarId: Long, events: List<CalendarMirrorEvent>, owner: String) {
        val existing = mutableMapOf<String, Long>()
        resolver.query(syncUri(Events.CONTENT_URI), arrayOf(Events._ID, Events._SYNC_ID),
            "${Events.CALENDAR_ID}=?", arrayOf(calendarId.toString()), null)?.use { cursor ->
            while (cursor.moveToNext()) existing[cursor.getString(1)] = cursor.getLong(0)
        } ?: error("Calendar events unavailable")
        val operations = arrayListOf<ContentProviderOperation>()
        fun flush() {
            if (operations.isNotEmpty()) {
                resolver.applyBatch(CalendarContract.AUTHORITY, operations)
                operations.clear()
            }
        }
        for (event in events) {
            val values = ContentValues().apply {
                put(Events.CALENDAR_ID, calendarId)
                put(Events._SYNC_ID, event.id)
                put(Events.TITLE, event.title)
                put(Events.DTSTART, event.start)
                put(Events.DTEND, event.end)
                put(Events.ALL_DAY, if (event.allDay) 1 else 0)
                put(Events.EVENT_TIMEZONE, if (event.allDay) "UTC" else TimeZone.getDefault().id)
                put(Events.EVENT_LOCATION, event.location)
                put(Events.DESCRIPTION, event.description)
                put(Events.HAS_ALARM, 0)
                put(Events.GUESTS_CAN_MODIFY, 0)
                put(Events.GUESTS_CAN_SEE_GUESTS, 1)
                put(Events.HAS_ATTENDEE_DATA, 1)
                put(Events.STATUS, Events.STATUS_CONFIRMED)
                put(Events.ORGANIZER, event.attendees.firstOrNull { it.organizer }?.email ?: "")
            }
            val id = existing.remove(event.id)
            val eventOperation = operations.size
            operations.add((if (id == null) ContentProviderOperation.newInsert(syncUri(Events.CONTENT_URI))
                else ContentProviderOperation.newUpdate(syncUri(ContentUris.withAppendedId(Events.CONTENT_URI, id))))
                .withValues(values).build())
            // Replace guests in the same transaction as the event, including removed guests.
            if (id != null) operations.add(ContentProviderOperation.newDelete(syncUri(Attendees.CONTENT_URI))
                .withSelection("${Attendees.EVENT_ID}=?", arrayOf(id.toString())).build())
            for (attendee in event.attendeesForOwner(owner)) {
                val guest = ContentProviderOperation.newInsert(syncUri(Attendees.CONTENT_URI))
                    .withValue(Attendees.ATTENDEE_NAME, attendee.name)
                    .withValue(Attendees.ATTENDEE_EMAIL, attendee.email)
                    .withValue(Attendees.ATTENDEE_RELATIONSHIP, if (attendee.organizer) Attendees.RELATIONSHIP_ORGANIZER else Attendees.RELATIONSHIP_ATTENDEE)
                    .withValue(Attendees.ATTENDEE_TYPE, Attendees.TYPE_NONE)
                    .withValue(Attendees.ATTENDEE_STATUS, attendee.status)
                if (id == null) guest.withValueBackReference(Attendees.EVENT_ID, eventOperation)
                else guest.withValue(Attendees.EVENT_ID, id)
                operations.add(guest.build())
            }
            if (operations.size >= 25) flush()
        }
        flush()
        // Prune only after every incoming event was written successfully; retries retain stable IDs.
        for (id in existing.values) {
            operations.add(ContentProviderOperation.newDelete(syncUri(ContentUris.withAppendedId(Events.CONTENT_URI, id))).build())
            if (operations.size >= 100) flush()
        }
        flush()
    }
}
