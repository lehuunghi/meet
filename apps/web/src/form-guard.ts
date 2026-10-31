import { useEffect } from "react";
import { installAcademyFormGuard } from "./form-guard-core";
export { allowPageLeave, submittingForm } from "./form-guard-core";
export function useAcademyFormGuard() {
  useEffect(installAcademyFormGuard, []);
}
