/** APK 中自带的无字按钮，所有自定义文字按钮共用。 */
export const COMMON_BUTTON = {
  image: 'assets/ui/common/button.png',
  pressed: 'assets/ui/common/button-pressed.png',
  cap: 80,
} as const;

export const COMMON_BUTTON_IMAGES = [COMMON_BUTTON.image, COMMON_BUTTON.pressed];
