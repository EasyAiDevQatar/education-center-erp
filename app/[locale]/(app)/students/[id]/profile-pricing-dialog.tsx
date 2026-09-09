"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Pencil } from "lucide-react";
import { EntityDialog } from "@/components/crud/entity-dialog";
import { FormField } from "@/components/crud/form-field";
import { Input } from "@/components/ui/input";
import { MultiSelect } from "@/components/ui/multi-select";
import { Button } from "@/components/ui/button";
import { saveStudentPricingAndTeachers } from "../actions";

export function ProfilePricingDialog({
  studentId,
  specialPricePerHour,
  teacherIds: initialTeacherIds,
  specialPriceTeacherIds: initialSpecialPriceTeacherIds,
  teachers,
}: {
  studentId: string;
  specialPricePerHour: number | null;
  teacherIds: string[];
  specialPriceTeacherIds: string[];
  teachers: { id: string; label: string }[];
}) {
  const locale = useLocale();
  const t = useTranslations("students");
  const tc = useTranslations("common");
  const [teacherIds, setTeacherIds] = useState(initialTeacherIds);
  const [specialPriceTeacherIds, setSpecialPriceTeacherIds] = useState(initialSpecialPriceTeacherIds);

  return (
    <EntityDialog
      title={t("pricingAndTeachers")}
      action={saveStudentPricingAndTeachers.bind(null, locale, studentId)}
      fields={
        <div className="space-y-4">
          <FormField label={t("specialPrice")} htmlFor="profile-special-price" hint={t("specialPriceHint")}>
            <Input
              id="profile-special-price"
              name="specialPricePerHour"
              type="number"
              min="0"
              step="0.01"
              dir="ltr"
              placeholder={t("matrixPrice")}
              defaultValue={specialPricePerHour ?? ""}
            />
          </FormField>
          <FormField label={t("assignedTeachers")} htmlFor="profile-teacher-ids" hint={t("assignedTeachersHint")}>
            <MultiSelect
              id="profile-teacher-ids"
              name="teacherIds"
              options={teachers.map((teacher) => ({ value: teacher.id, label: teacher.label }))}
              value={teacherIds}
              onChange={setTeacherIds}
              placeholder={t("noTeachersAssigned")}
            />
          </FormField>
          <FormField
            label={t("specialPriceTeachers")}
            htmlFor="profile-special-price-teacher-ids"
            hint={t("specialPriceTeachersHint")}
          >
            <MultiSelect
              id="profile-special-price-teacher-ids"
              name="specialPriceTeacherIds"
              options={teachers.map((teacher) => ({ value: teacher.id, label: teacher.label }))}
              value={specialPriceTeacherIds}
              onChange={setSpecialPriceTeacherIds}
              placeholder={t("allTeachers")}
            />
          </FormField>
        </div>
      }
      trigger={
        <Button variant="outline" className="gap-2">
          <Pencil className="size-4" />
          {tc("edit")}
        </Button>
      }
    />
  );
}
