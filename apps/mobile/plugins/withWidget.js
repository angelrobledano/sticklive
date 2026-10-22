const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Expo Config Plugin para añadir el Home Screen Widget nativo en Stick Live.
 * - Registra el AppWidgetProvider en AndroidManifest.xml.
 * - Copia los layouts y metadatos XML nativos al proyecto generado.
 */
function withWidget(config) {
  // 1. Android Manifest: añadir receiver del widget
  config = withAndroidManifest(config, (modConfig) => {
    const mainApplication = modConfig.modResults.manifest.application?.[0];
    if (mainApplication) {
      mainApplication.receiver = mainApplication.receiver || [];
      const hasWidget = mainApplication.receiver.some(
        (r) =>
          r.$['android:name'] === '.StickLiveWidgetProvider' ||
          r.$['android:name'] === 'eu.sticklive.app.StickLiveWidgetProvider',
      );
      if (!hasWidget) {
        mainApplication.receiver.push({
          $: {
            'android:name': '.StickLiveWidgetProvider',
            'android:exported': 'true',
            'android:label': 'Stick Live Marcador',
          },
          'intent-filter': [
            {
              action: [
                {
                  $: {
                    'android:name': 'android.appwidget.action.APPWIDGET_UPDATE',
                  },
                },
                {
                  $: {
                    'android:name': 'eu.sticklive.app.ACTION_UPDATE_WIDGET',
                  },
                },
              ],
            },
          ],
          'meta-data': [
            {
              $: {
                'android:name': 'android.appwidget.provider',
                'android:resource': '@xml/widget_live_match_info',
              },
            },
          ],
        });
      }
    }
    return modConfig;
  });

  // 2. Copiar archivos de recursos (layout, xml, drawable, kotlin)
  config = withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const projectRoot = modConfig.modRequest.projectRoot;
      const resDir = path.join(projectRoot, 'android', 'app', 'src', 'main', 'res');
      const javaDir = path.join(
        projectRoot,
        'android',
        'app',
        'src',
        'main',
        'java',
        'eu',
        'sticklive',
        'app',
      );

      if (fs.existsSync(resDir)) {
        const layoutDir = path.join(resDir, 'layout');
        const xmlDir = path.join(resDir, 'xml');
        const drawableDir = path.join(resDir, 'drawable');

        fs.mkdirSync(layoutDir, { recursive: true });
        fs.mkdirSync(xmlDir, { recursive: true });
        fs.mkdirSync(drawableDir, { recursive: true });

        const widgetSrc = path.join(projectRoot, 'android-widgets');
        if (fs.existsSync(widgetSrc)) {
          const srcLayout = path.join(widgetSrc, 'res', 'layout', 'widget_live_match.xml');
          const srcXml = path.join(widgetSrc, 'res', 'xml', 'widget_live_match_info.xml');
          const srcDrawable = path.join(widgetSrc, 'res', 'drawable', 'widget_background.xml');
          const srcKt = path.join(widgetSrc, 'StickLiveWidgetProvider.kt');

          if (fs.existsSync(srcLayout)) {
            fs.copyFileSync(srcLayout, path.join(layoutDir, 'widget_live_match.xml'));
          }
          if (fs.existsSync(srcXml)) {
            fs.copyFileSync(srcXml, path.join(xmlDir, 'widget_live_match_info.xml'));
          }
          if (fs.existsSync(srcDrawable)) {
            fs.copyFileSync(srcDrawable, path.join(drawableDir, 'widget_background.xml'));
          }
          if (fs.existsSync(javaDir) && fs.existsSync(srcKt)) {
            fs.copyFileSync(srcKt, path.join(javaDir, 'StickLiveWidgetProvider.kt'));
          }
        }
      }
      return modConfig;
    },
  ]);

  return config;
}

module.exports = withWidget;
