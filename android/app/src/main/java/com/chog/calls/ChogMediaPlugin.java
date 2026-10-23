package com.chog.calls;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;

/**
 * Saves a share card to the phone's photos (src/lib/nativeShare.ts). MediaStore puts it in
 * Pictures/Choglander, where the gallery and Google Photos find it, without any storage
 * permission. Android 9 and older would need one, so there it rejects and the page offers the
 * share sheet's "Save to device" instead.
 */
@CapacitorPlugin(name = "ChogMedia")
public class ChogMediaPlugin extends Plugin {
    private static final int MAX_BYTES = 12 * 1024 * 1024;

    /** saveImage({data: base64 PNG, name}) -> {uri} */
    @PluginMethod
    public void saveImage(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("Saving to photos needs Android 10 or newer", "UNSUPPORTED");
            return;
        }
        String data = call.getString("data");
        if (data == null || data.isEmpty()) {
            call.reject("Missing image");
            return;
        }
        String name = call.getString("name", "chog.png");
        if (!name.matches("[A-Za-z0-9._-]{1,80}")) name = "chog.png";
        byte[] bytes;
        try {
            bytes = Base64.decode(data, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("Not an image");
            return;
        }
        if (bytes.length == 0 || bytes.length > MAX_BYTES) {
            call.reject("Not an image");
            return;
        }

        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, name);
        values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
        values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Choglander");
        values.put(MediaStore.Images.Media.IS_PENDING, 1);
        Uri uri = null;
        try {
            uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            if (uri == null) throw new IllegalStateException("No media entry");
            try (OutputStream out = resolver.openOutputStream(uri)) {
                if (out == null) throw new IllegalStateException("No output stream");
                out.write(bytes);
            }
            ContentValues done = new ContentValues();
            done.put(MediaStore.Images.Media.IS_PENDING, 0);
            resolver.update(uri, done, null, null);
            JSObject result = new JSObject();
            result.put("uri", uri.toString());
            call.resolve(result);
        } catch (Exception e) {
            if (uri != null) {
                try {
                    resolver.delete(uri, null, null);
                } catch (Exception ignored) {
                    // the half-written entry stays pending and the system clears it
                }
            }
            call.reject("Could not save the image", e);
        }
    }
}
