// Theme registry. Surface colors live in css/styles.css under [data-skin="..."].
// Series colors use a colorblind-validated categorical palette, stepped separately for light and dark surfaces.
window.THEMES = {
  midnight:  { label: 'Midnight',  mode: 'dark',  swatch: ['#0b1220', '#3987e5'] },
  aurora:    { label: 'Aurora',    mode: 'dark',  swatch: ['#0d1a1c', '#2fd4a7'] },
  daylight:  { label: 'Daylight',  mode: 'light', swatch: ['#f6f7f9', '#2a78d6'] },
  sandstone: { label: 'Sandstone', mode: 'light', swatch: ['#f7f2ea', '#c2571a'] },
  corporate: { label: 'Corporate', mode: 'light', swatch: ['#ffffff', '#f2c811'] },
};
window.SERIES = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  dark:  ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
};
