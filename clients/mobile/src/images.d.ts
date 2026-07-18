/** Let TypeScript treat bundled image imports as React Native image sources. */
declare module '*.png' {
  import type { ImageSourcePropType } from 'react-native';

  const value: ImageSourcePropType;
  export default value;
}
