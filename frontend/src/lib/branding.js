export const APP_NAME = "FitnessVitness CRM";
export const APP_NAME_SHORT = "FitnessVitness";
export const LOGO_SRC = "/assets/logo.svg";

export function copyrightLine(year = new Date().getFullYear()) {
  return `Copyright © ${year} ${APP_NAME}. All rights reserved.`;
}
