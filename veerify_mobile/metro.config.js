const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  resolver: {
    // Block native build outputs so Metro's file watcher doesn't crash on
    // transient CMake/Gradle temp files getting created and deleted.
    blockList: /([\\/]android[\\/]app[\\/]build[\\/].*)|([\\/]android[\\/]app[\\/]\.cxx[\\/].*)|([\\/]android[\\/]build[\\/].*)|([\\/]android[\\/]\.gradle[\\/].*)|([\\/]ios[\\/]build[\\/].*)|([\\/]ios[\\/]Pods[\\/].*)/,
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
