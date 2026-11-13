package com.noonreport.voyagemanager;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.CalendarContract;
import android.webkit.JavascriptInterface;

import java.util.TimeZone;

/**
 * What the Notes page can ask of the phone: keep these alarms, and keep this
 * note's event in the calendar. The page is the only caller.
 *
 * A note's calendar event is written straight into the calendar and remembered
 * against the note's id, so editing the note changes that same event instead of
 * leaving the old one behind and opening a screen to add another.
 */
public class ReminderBridge {
  private static final int NOTIFY_REQUEST = 4711;
  private static final int CALENDAR_REQUEST = 4712;
  private static final String CAL_PREFS = "cheng_calendar_events";
  private final Activity activity;

  ReminderBridge(Activity activity) {
    this.activity = activity;
  }

  /** Replace every alarm with this JSON list; returns whether it was accepted. */
  @JavascriptInterface
  public boolean sync(String json) {
    try {
      ReminderScheduler.replaceAll(activity.getApplicationContext(), json);
      askToNotify();
      return true;
    } catch (Exception e) {
      return false;
    }
  }

  /** "granted" once the calendar can be read and written. */
  @JavascriptInterface
  public String calendarPermission() {
    if (Build.VERSION.SDK_INT < 23) return "granted";
    boolean read = activity.checkSelfPermission("android.permission.READ_CALENDAR") == PackageManager.PERMISSION_GRANTED;
    boolean write = activity.checkSelfPermission("android.permission.WRITE_CALENDAR") == PackageManager.PERMISSION_GRANTED;
    return read && write ? "granted" : "denied";
  }

  /** Asks the user once; the page polls calendarPermission() for the answer. */
  @JavascriptInterface
  public void requestCalendarPermission() {
    if (Build.VERSION.SDK_INT < 23) return;
    activity.runOnUiThread(() -> activity.requestPermissions(
        new String[] {"android.permission.READ_CALENDAR", "android.permission.WRITE_CALENDAR"}, CALENDAR_REQUEST));
  }

  /**
   * Puts the note in the calendar, or brings its event up to date. Returns
   * "ok:inserted", "ok:updated", "denied" (no permission), "nocalendar" (no
   * writable calendar on the device) or "error:...".
   */
  @JavascriptInterface
  public String upsertCalendarEvent(String noteId, String title, String description,
                                    double startMs, double durationMin, double leadMin) {
    try {
      if (!"granted".equals(calendarPermission())) return "denied";
      if (noteId == null || noteId.isEmpty()) return "error:no id";
      ContentResolver cr = activity.getContentResolver();
      long start = (long) startMs;
      long end = start + (long) (durationMin * 60000d);
      SharedPreferences prefs = activity.getSharedPreferences(CAL_PREFS, Context.MODE_PRIVATE);
      long eventId = prefs.getLong(noteId, -1L);
      boolean exists = eventId >= 0 && eventExists(cr, eventId);

      ContentValues v = new ContentValues();
      v.put(CalendarContract.Events.TITLE, title);
      v.put(CalendarContract.Events.DESCRIPTION, description);
      v.put(CalendarContract.Events.DTSTART, start);
      v.put(CalendarContract.Events.DTEND, end);
      v.put(CalendarContract.Events.EVENT_TIMEZONE, TimeZone.getDefault().getID());
      v.put(CalendarContract.Events.HAS_ALARM, 1);

      if (exists) {
        cr.update(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, eventId), v, null, null);
        replaceReminder(cr, eventId, (int) leadMin);
        return "ok:updated";
      }
      long calendarId = writableCalendarId(cr);
      if (calendarId < 0) return "nocalendar";
      v.put(CalendarContract.Events.CALENDAR_ID, calendarId);
      Uri created = cr.insert(CalendarContract.Events.CONTENT_URI, v);
      if (created == null) return "error:the calendar refused the event";
      eventId = ContentUris.parseId(created);
      prefs.edit().putLong(noteId, eventId).apply();
      replaceReminder(cr, eventId, (int) leadMin);
      return "ok:inserted";
    } catch (Exception e) {
      return "error:" + e.getMessage();
    }
  }

  /** Takes the note's event out of the calendar. "ok", "none" (it had none) or "denied". */
  @JavascriptInterface
  public String removeCalendarEvent(String noteId) {
    try {
      SharedPreferences prefs = activity.getSharedPreferences(CAL_PREFS, Context.MODE_PRIVATE);
      long eventId = prefs.getLong(noteId, -1L);
      if (eventId < 0) return "none";
      if (!"granted".equals(calendarPermission())) return "denied";
      activity.getContentResolver().delete(
          ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, eventId), null, null);
      prefs.edit().remove(noteId).apply();
      return "ok";
    } catch (Exception e) {
      return "error:" + e.getMessage();
    }
  }

  /**
   * Opens the calendar's new-event screen, filled in, for a phone where the
   * calendar permission was refused. The user saves it there.
   */
  @JavascriptInterface
  public boolean addToCalendar(String title, String description, double startMs, double durationMin, double leadMin) {
    try {
      final long start = (long) startMs;
      final long end = start + (long) (durationMin * 60000d);
      final Intent intent = new Intent(Intent.ACTION_INSERT)
          .setData(CalendarContract.Events.CONTENT_URI)
          .putExtra(CalendarContract.Events.TITLE, title)
          .putExtra(CalendarContract.Events.DESCRIPTION, description)
          .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, start)
          .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, end);
      activity.runOnUiThread(() -> {
        try {
          activity.startActivity(intent);
        } catch (Exception ignored) {
          /* No calendar app installed. */
        }
      });
      return intent.resolveActivity(activity.getPackageManager()) != null;
    } catch (Exception e) {
      return false;
    }
  }

  private boolean eventExists(ContentResolver cr, long eventId) {
    Cursor c = null;
    try {
      c = cr.query(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, eventId),
          new String[] {CalendarContract.Events._ID, CalendarContract.Events.DELETED}, null, null, null);
      return c != null && c.moveToFirst() && c.getInt(1) == 0;
    } catch (Exception e) {
      return false;
    } finally {
      if (c != null) c.close();
    }
  }

  /** The calendar to put events in: one the user can write to, their own account's first. */
  private long writableCalendarId(ContentResolver cr) {
    Cursor c = null;
    try {
      c = cr.query(CalendarContract.Calendars.CONTENT_URI,
          new String[] {CalendarContract.Calendars._ID, CalendarContract.Calendars.ACCOUNT_TYPE,
              CalendarContract.Calendars.ACCOUNT_NAME, CalendarContract.Calendars.OWNER_ACCOUNT},
          CalendarContract.Calendars.VISIBLE + "=1 AND "
              + CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL + ">=" + CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR,
          null, null);
      long best = -1;
      int bestScore = -1;
      while (c != null && c.moveToNext()) {
        int score = 0;
        String type = c.getString(1);
        String account = c.getString(2);
        String owner = c.getString(3);
        if (account != null && account.equals(owner)) score += 4;
        if (type != null && !CalendarContract.ACCOUNT_TYPE_LOCAL.equals(type)) score += 2;
        if (score > bestScore) {
          bestScore = score;
          best = c.getLong(0);
        }
      }
      return best;
    } catch (Exception e) {
      return -1;
    } finally {
      if (c != null) c.close();
    }
  }

  /** One alert, at the lead the note asked for, in place of whatever the event had. */
  private void replaceReminder(ContentResolver cr, long eventId, int leadMin) {
    try {
      cr.delete(CalendarContract.Reminders.CONTENT_URI,
          CalendarContract.Reminders.EVENT_ID + "=?", new String[] {String.valueOf(eventId)});
      ContentValues r = new ContentValues();
      r.put(CalendarContract.Reminders.EVENT_ID, eventId);
      r.put(CalendarContract.Reminders.MINUTES, Math.max(0, leadMin));
      r.put(CalendarContract.Reminders.METHOD, CalendarContract.Reminders.METHOD_ALERT);
      cr.insert(CalendarContract.Reminders.CONTENT_URI, r);
    } catch (Exception ignored) {
      /* The event is in; only its alert is missing. */
    }
  }

  /** From Android 13 a notification, and so the alarm's ring, needs the user's yes. */
  private void askToNotify() {
    if (Build.VERSION.SDK_INT < 33) return;
    if (activity.checkSelfPermission("android.permission.POST_NOTIFICATIONS")
        == PackageManager.PERMISSION_GRANTED) return;
    activity.runOnUiThread(() -> activity.requestPermissions(
        new String[] {"android.permission.POST_NOTIFICATIONS"}, NOTIFY_REQUEST));
  }
}
