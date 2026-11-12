package com.noonreport.voyagemanager;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Alarms do not survive a reboot or an app update; put them back. */
public class ReminderBootReceiver extends BroadcastReceiver {
  @Override
  public void onReceive(Context ctx, Intent intent) {
    ReminderScheduler.restore(ctx.getApplicationContext());
  }
}
