/**
 * The logo: a wireframe globe with an orbit and a satellite in the accent colour.
 * It draws in the text colour, so it follows the theme. public/favicon.svg is the same mark on a dark tile.
 */
export const LOGO_SVG = `<svg class="logo" viewBox="0 0 64 64" aria-hidden="true">
  <circle cx="32" cy="32" r="19" fill="none" stroke="currentColor" stroke-width="4"/>
  <ellipse cx="32" cy="32" rx="8" ry="19" fill="none" stroke="currentColor" stroke-width="2.4"/>
  <path d="M13 32h38" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
  <ellipse cx="32" cy="32" rx="29" ry="9.5" transform="rotate(-25 32 32)" fill="none" stroke="currentColor" stroke-width="2.4" opacity=".75"/>
  <circle cx="58.3" cy="19.7" r="4.6" fill="#f5a04a"/>
</svg>`;
