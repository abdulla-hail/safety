import ActionButton from "@/components/ui/ActionButton";
import { btnDangerOutline, btnSecondary } from "@/components/ui/styles";
import { deleteRecord, setArchived } from "@/app/(app)/actions";

/** أزرار الأرشفة/الاستعادة/الحذف الموحدة لكل الوحدات. */
export default function RecordActions({
  table,
  id,
  archived,
  canArchive,
  canDelete,
  back,
  listPath,
  noun = "السجل",
}: {
  table: string;
  id: string;
  archived: boolean;
  canArchive: boolean;
  canDelete: boolean;
  back: string;
  listPath: string;
  noun?: string;
}) {
  return (
    <>
      {canArchive && (
        <ActionButton
          action={setArchived}
          hidden={{ table, id, archive: archived ? "0" : "1", back }}
          label={archived ? "استعادة من الأرشيف" : "أرشفة"}
          confirm={archived ? `استعادة ${noun} من الأرشيف؟` : `أرشفة ${noun}؟ سيختفي من القوائم التشغيلية مع بقاء بياناته وسجلاته التاريخية.`}
          className={btnSecondary}
        />
      )}
      {canDelete && (
        <ActionButton
          action={deleteRecord}
          hidden={{ table, id, back: listPath }}
          label="حذف نهائي"
          confirm={`حذف ${noun} نهائيًا؟ لا يمكن التراجع. إذا كان مرتبطًا بسجلات أخرى سيُرفض الحذف ويُقترح الأرشفة.`}
          className={btnDangerOutline}
        />
      )}
    </>
  );
}
