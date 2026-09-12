function requiredCollectionValue(name) {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`${name} is required for the collection app flavor`)
  }
  return value
}

module.exports = ({ config }) => {
  if (process.env.VOXFLAME_APP_FLAVOR !== 'collection') {
    return config
  }

  const name = requiredCollectionValue('EXPO_PUBLIC_APP_BRAND_NAME')
  const icon = requiredCollectionValue('VOXFLAME_COLLECTION_APP_ICON')
  return {
    ...config,
    name,
    slug: requiredCollectionValue('VOXFLAME_COLLECTION_APP_SLUG'),
    scheme: requiredCollectionValue('VOXFLAME_COLLECTION_APP_SCHEME'),
    icon,
    ios: {
      ...config.ios,
      bundleIdentifier: requiredCollectionValue('VOXFLAME_COLLECTION_IOS_BUNDLE_IDENTIFIER'),
      infoPlist: {
        ...config.ios?.infoPlist,
        NSMicrophoneUsageDescription: `${name}需要麦克风权限用于沟通、练习录音和用户确认后的训练样本采集。`,
      },
    },
    android: {
      ...config.android,
      package: requiredCollectionValue('VOXFLAME_COLLECTION_ANDROID_PACKAGE'),
      adaptiveIcon: {
        ...config.android?.adaptiveIcon,
        foregroundImage: requiredCollectionValue('VOXFLAME_COLLECTION_ANDROID_ADAPTIVE_ICON'),
        backgroundColor: process.env.EXPO_PUBLIC_APP_BRAND_BACKGROUND?.trim() || '#F5F1EA',
      },
    },
    extra: {
      ...config.extra,
      eas: {
        projectId: requiredCollectionValue('VOXFLAME_COLLECTION_EAS_PROJECT_ID'),
      },
    },
  }
}
