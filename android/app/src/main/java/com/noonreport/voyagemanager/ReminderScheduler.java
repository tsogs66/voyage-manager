package com.noonreport.voyagemanager;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

/** Keeps the alarms the Notes page asked for, and hands them to the system clock. */
final class ReminderScheduler {
  static final String PREFS = "cheng_reminders";
  static final String KEY = "alarms";
  static final String CHANNEL = "cheng_alarm_v1";

  private ReminderScheduler() {}

  private static PendingIntent operation(Context ctx, JSONObject a, int flags) throws Exception {
    String id = a.getString("id");
    Intent intent = new Intent(ctx, ReminderReceiver.class);
    intent.setData(Uri.parse("cheng-reminder://" + Uri.encode(id)));
    intent.putExtra("id", id);
    intent.putExtra("title", a.optString("title", "Note"));
    intent.putExtra("body", a.optString("body", ""));
    intent.putExtra("deadlineAt", a.optLong("deadlineAt", 0L));
    int f = flags;
    if (Build.VERSION.SDK_INT >= 23) f |= PendingIntent.FLAG_IMMUTABLE;
    return PendingIntent.getBroadcast(ctx, id.hashCode(), intent, f);
  }

  private static PendingIntent showApp(Context ctx) {
    Intent open = new Intent(ctx, MainActivity.class);
    open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    int f = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= 23) f |= PendingIntent.FLAG_IMMUTABLE;
    return PendingIntent.getActivity(ctx, 0, open, f);
  }

  private static JSONArray stored(Context ctx) {
    try {
      return new JSONArray(prefs(ctx).getString(KEY, "[]"));
    } catch (Exception e) {
      return new JSONArray();
    }
  }

  private static SharedPreferences prefs(Context ctx) {
    return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
  }

  private static void cancel(Context ctx, JSONArray list) {
    AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
    if (am == null) return;
    for (int i = 0; i < list.length(); i++) {
      try {
        am.cancel(operation(ctx, list.getJSONObject(i), PendingIntent.FLAG_UPDATE_CURRENT));
      } catch (Exception ignored) {
      }
    }
  }

  private static void arm(Context ctx, JSONArray list) {
    AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
    if (am == null) return;
    long now = System.currentTimeMillis();
    for (int i = 0; i < list.length(); i++) {
      try {
        JSONObject a = list.getJSONObject(i);
        long at = a.getLong("fireAt");
        if (at <= now) continue;
        am.setAlarmClock(new AlarmManager.AlarmClockInfo(at, showApp(ctx)),
            operation(ctx, a, PendingIntent.FLAG_UPDATE_CURRENT));
      } catch (Exception ignored) {
      }
    }
  }

  /** The page sends the complete set each time: what is not in it is cancelled. */
  static void replaceAll(Context ctx, String json) {
    JSONArray next;
    try {
      next = new JSONArray(json == null ? "[]" : json);
    } catch (Exception e) {
      return;
    }
    cancel(ctx, stored(ctx));
    prefs(ctx).edit().putString(KEY, next.toString()).apply();
    arm(ctx, next);
  }

  /** After a reboot or an app update the system has forgotten them all. */
  static void restore(Context ctx) {
    arm(ctx, stored(ctx));
  }

  /** An alarm that has rung is not kept, so it is not set again on the next boot. */
  static void forget(Context ctx, String id) {
    JSONArray old = stored(ctx);
    JSONArray keep = new JSONArray();
    for (int i = 0; i < old.length(); i++) {
      JSONObject a = old.optJSONObject(i);
      if (a != null && !id.equals(a.optString("id"))) keep.put(a);
    }
    prefs(ctx).edit().putString(KEY, keep.toString()).apply();
  }
}
