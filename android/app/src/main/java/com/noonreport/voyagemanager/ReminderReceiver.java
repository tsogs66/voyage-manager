package com.noonreport.voyagemanager;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

import java.text.DateFormat;
import java.util.Date;

/** Rings when the system clock fires a note's alarm. */
public class ReminderReceiver extends BroadcastReceiver {
  @Override
  public void onReceive(Context ctx, Intent intent) {
    String id = intent.getStringExtra("id");
    String title = intent.getStringExtra("title");
    String body = intent.getStringExtra("body");
    long deadlineAt = intent.getLongExtra("deadlineAt", 0L);
    if (id == null) return;
    if (title == null || title.isEmpty()) title = "Note";

    NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
    if (nm == null) return;
    Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
    if (sound == null) sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);

    Notification.Builder b;
    if (Build.VERSION.SDK_INT >= 26) {
      if (nm.getNotificationChannel(ReminderScheduler.CHANNEL) == null) {
        NotificationChannel ch = new NotificationChannel(
            ReminderScheduler.CHANNEL, "Note alarms", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Alarms set on a note's deadline");
        ch.setSound(sound, new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build());
        ch.enableVibration(true);
        ch.setVibrationPattern(new long[] {0, 600, 300, 600, 300, 600});
        nm.createNotificationChannel(ch);
      }
      b = new Notification.Builder(ctx, ReminderScheduler.CHANNEL);
    } else {
      b = new Notification.Builder(ctx);
      b.setSound(sound, AudioManagerStream.ALARM);
      b.setVibrate(new long[] {0, 600, 300, 600, 300, 600});
      b.setPriority(Notification.PRIORITY_HIGH);
    }

    String text = body == null ? "" : body;
    if (deadlineAt > 0) {
      String when = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(new Date(deadlineAt));
      text = text.isEmpty() ? when : when + " — " + text;
    }
    Intent open = new Intent(ctx, MainActivity.class);
    open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    int flags = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
    PendingIntent tap = PendingIntent.getActivity(ctx, id.hashCode(), open, flags);

    b.setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
        .setContentTitle(title)
        .setContentText(text)
        .setStyle(new Notification.BigTextStyle().bigText(text))
        .setCategory(Notification.CATEGORY_ALARM)
        .setContentIntent(tap)
        .setAutoCancel(true)
        .setWhen(System.currentTimeMillis());
    Notification n = b.build();
    /* Keep sounding until it is dealt with, as an alarm does. */
    n.flags |= Notification.FLAG_INSISTENT;
    nm.notify(id.hashCode(), n);
    ReminderScheduler.forget(ctx, id);
  }

  /** android.media.AudioManager.STREAM_ALARM, named for what it is here. */
  private static final class AudioManagerStream {
    static final int ALARM = android.media.AudioManager.STREAM_ALARM;
  }
}
