package com.logisol.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Télécharge et déclenche l'installeur système Android pour une mise à
 * jour de l'appli elle-même, distribuée hors Play Store (voir
 * www/js/maj-apk.js). download() récupère l'APK et install() l'expose via
 * le FileProvider déjà configuré (AndroidManifest.xml / file_paths.xml)
 * puis lance l'intent système d'installation. Les deux méthodes lisent/
 * écrivent le même fichier dans le cache de l'appli (context.getCacheDir()).
 * C'est ensuite Android, jamais ce code, qui affiche l'écran de
 * confirmation et décide d'installer -- rien ici ne touche aux données de
 * l'appli (IndexedDB/localStorage/cache Firestore hors-ligne), qu'Android
 * préserve automatiquement lors d'une mise à jour par-dessus l'existant
 * (même applicationId + même clé de signature, garantis par le keystore
 * stable du pipeline CI -- voir .github/workflows/build-android.yml et
 * android/app/build.gradle).
 *
 * Porté depuis Ovilog (VincentVaysset/Ovilog, branche
 * claude/sheep-herd-android-app-7tlcq1) : même mécanisme, seul le package
 * change (com.ovilog.app -> com.logisol.app).
 */
@CapacitorPlugin(name = "ApkInstaller")
public class ApkInstallerPlugin extends Plugin {

    // Android 8 (API 26) a introduit l'autorisation "Installer des
    // applications inconnues", accordée par source (par appli), à la place
    // du réglage global "Sources inconnues" des versions antérieures --
    // en dessous de cette API, aucune vérification n'est nécessaire.
    @PluginMethod
    public void canRequestInstall(PluginCall call) {
        boolean granted = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            granted = getContext().getPackageManager().canRequestPackageInstalls();
        }
        JSObject ret = new JSObject();
        ret.put("value", granted);
        call.resolve(ret);
    }

    // Ouvre l'écran système où l'utilisateur active "Installer des
    // applications inconnues" pour Logisol -- ne peut pas être accordée par
    // code, uniquement par l'utilisateur lui-même (protection Android). Sans
    // effet en dessous d'Android 8 (aucun écran équivalent nécessaire).
    @PluginMethod
    public void openInstallPermissionSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        }
        call.resolve();
    }

    // Télécharge l'APK de mise à jour et l'écrit directement dans le cache
    // de l'appli (même dossier que install() lit ensuite). Fait ici, en
    // Java, plutôt qu'un fetch() côté JS : GitHub ne renvoie AUCUN en-tête
    // Access-Control-Allow-Origin sur le téléchargement des assets de
    // release (contrairement à l'API /releases elle-même, qui en renvoie
    // un) -- un fetch() depuis la WebView échoue donc systématiquement
    // avec "Failed to fetch" (bug déjà rencontré et corrigé côté Ovilog).
    // HttpURLConnection, exécuté ici hors WebView, n'est pas soumis à
    // cette restriction (CORS est une politique de navigateur, pas du
    // protocole HTTP lui-même). Suit automatiquement la redirection 302 de
    // github.com vers le stockage réel de l'asset (releases-assets/Azure
    // Blob), aucune configuration supplémentaire nécessaire.
    @PluginMethod
    public void download(PluginCall call) {
        String urlString = call.getString("url");
        String fileName = call.getString("fileName");
        if (urlString == null || urlString.isEmpty() || fileName == null || fileName.isEmpty()) {
            call.reject("url ou fileName manquant");
            return;
        }
        InputStream input = null;
        FileOutputStream output = null;
        try {
            URL url = new URL(urlString);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            conn.connect();
            int code = conn.getResponseCode();
            if (code != HttpURLConnection.HTTP_OK) {
                call.reject("Téléchargement impossible (code " + code + ")");
                return;
            }
            File outFile = new File(getContext().getCacheDir(), fileName);
            input = conn.getInputStream();
            output = new FileOutputStream(outFile);
            byte[] buffer = new byte[8192];
            int len;
            while ((len = input.read(buffer)) != -1) {
                output.write(buffer, 0, len);
            }
            output.flush();
            call.resolve();
        } catch (Exception e) {
            call.reject("Échec du téléchargement : " + e.getMessage(), e);
        } finally {
            try { if (input != null) input.close(); } catch (Exception ignored) {}
            try { if (output != null) output.close(); } catch (Exception ignored) {}
        }
    }

    // fileName : nom du fichier déjà présent dans le cache de l'appli
    // (context.getCacheDir(), le même dossier que Directory.Cache côté
    // @capacitor/filesystem -- voir download() ci-dessus, qui écrit
    // directement dans ce même dossier).
    @PluginMethod
    public void install(PluginCall call) {
        String fileName = call.getString("fileName");
        if (fileName == null || fileName.isEmpty()) {
            call.reject("fileName manquant");
            return;
        }
        File apkFile = new File(getContext().getCacheDir(), fileName);
        if (!apkFile.exists()) {
            call.reject("Fichier introuvable : " + fileName);
            return;
        }
        try {
            Uri apkUri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apkFile);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Impossible de lancer l'installation : " + e.getMessage(), e);
        }
    }
}
