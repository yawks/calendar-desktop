import { nativeAndroidPlatform } from './nativeAndroid';
import { webPlatform } from './web';

export const platform = nativeAndroidPlatform.isNativeAndroid ? nativeAndroidPlatform : webPlatform;
export type * from './types';
