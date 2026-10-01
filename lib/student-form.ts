/** Values shared by the student create/edit form and its duplicate workflow. */
export type StudentFormDefaults = {
  name: string;
  nameEn: string | null;
  phone: string | null;
  gradeLevelId: string | null;
  gradeYear: number | null;
  specialPricePerHour: number | null;
  guardianId: string | null;
  studyLocation: "CENTER" | "HOME";
  active: boolean;
  notes: string | null;
  address: string | null;
  homeLat: number | null;
  homeLng: number | null;
  checkinPin: string | null;
  homeCode: string | null;
  teacherIds: string[];
  specialPriceTeacherIds: string[];
};

export type GuardianHomeSnapshot = {
  id: string;
  label: string;
  address: string | null;
  homeCode: string | null;
  homeLat: number | null;
  homeLng: number | null;
  isDefault: boolean;
};

export type StudentHomeFieldValues = {
  address: string;
  homeCode: string;
  lat: string;
  lng: string;
};

export function guardianHomeFieldValues(home: GuardianHomeSnapshot): StudentHomeFieldValues {
  return {
    address: home.address ?? "",
    homeCode: home.homeCode ?? "",
    lat: home.homeLat == null ? "" : String(home.homeLat),
    lng: home.homeLng == null ? "" : String(home.homeLng),
  };
}

/**
 * Remove only values that still match a parent home applied by the form.
 * Any field the operator changed afterward is intentionally retained.
 */
export function clearAppliedGuardianHome(
  current: StudentHomeFieldValues,
  applied: StudentHomeFieldValues,
): StudentHomeFieldValues {
  return {
    address: current.address === applied.address ? "" : current.address,
    homeCode: current.homeCode === applied.homeCode ? "" : current.homeCode,
    lat: current.lat === applied.lat ? "" : current.lat,
    lng: current.lng === applied.lng ? "" : current.lng,
  };
}

/**
 * Prepare a safe sibling-style copy without creating a database record.
 *
 * Family, teaching, pricing and home defaults are useful to retain. Identity,
 * free-form history and the attendance secret must be entered for the new
 * child, and relation arrays are copied so editing the draft cannot mutate the
 * source row in client state.
 */
export function duplicateStudentDefaults(source: StudentFormDefaults): StudentFormDefaults {
  return {
    ...source,
    name: "",
    nameEn: null,
    phone: null,
    notes: null,
    checkinPin: null,
    active: true,
    teacherIds: [...source.teacherIds],
    specialPriceTeacherIds: [...source.specialPriceTeacherIds],
  };
}

/** The home a newly selected parent should offer first. */
export function preferredGuardianHome(
  homes: readonly GuardianHomeSnapshot[],
): GuardianHomeSnapshot | null {
  return homes.find((home) => home.isDefault) ?? homes[0] ?? null;
}
