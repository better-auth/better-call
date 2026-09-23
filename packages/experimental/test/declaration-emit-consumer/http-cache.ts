/**
 * Dependent-package fixture: export an `http()` wrapper through the package
 * subpath with no local return annotation. Declaration emit under node16 +
 * composite must name the type via `better-call/http` (TS2742 / TS2883).
 */
import { http } from "better-call/http";

export const authHttp = http();
