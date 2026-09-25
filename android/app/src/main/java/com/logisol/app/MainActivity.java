package com.logisol.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // registerPlugin() doit être appelé AVANT super.onCreate() : c'est
        // ce dernier qui construit le pont Capacitor avec la liste des
        // plugins accumulée jusque-là (voir BridgeActivity.load()).
        registerPlugin(ApkInstallerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
