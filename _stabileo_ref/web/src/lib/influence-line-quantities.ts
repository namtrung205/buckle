/**
 * The quantities an influence line can be drawn for, in two groups.
 *
 * This list used to be written out as buttons in two places — the desktop
 * options bar and the floating toolbar — and this very arrangement had to be
 * edited in both when the quantities were renamed (Ry→Rz, Mz→My). The data
 * lives here once; each platform keeps its own button styling.
 */
export const IL_QUANTITY_GROUPS = [
  {
    labelKey: 'float.reactions',
    quantities: [
      { id: 'Rz', labelKey: 'float.rzVertical' },
      { id: 'Rx', labelKey: 'float.rxHoriz' },
      { id: 'My', labelKey: 'float.mySupport' },
    ],
  },
  {
    labelKey: 'float.internal',
    quantities: [
      { id: 'M', labelKey: 'float.mMoment' },
      { id: 'V', labelKey: 'float.vShear' },
    ],
  },
] as const;

export type IlQuantityId = (typeof IL_QUANTITY_GROUPS)[number]['quantities'][number]['id'];
