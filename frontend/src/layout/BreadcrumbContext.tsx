import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { BreadcrumbCrumb } from './navigationConfig';

interface BreadcrumbContextValue {
  trail: BreadcrumbCrumb[];
  setTrail: (items: BreadcrumbCrumb[]) => void;
}

const BreadcrumbContext = createContext<BreadcrumbContextValue>({
  trail: [],
  setTrail: () => undefined,
});

export const BreadcrumbProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [trail, setTrailState] = useState<BreadcrumbCrumb[]>([]);
  const setTrail = useCallback((items: BreadcrumbCrumb[]) => {
    setTrailState(items);
  }, []);
  return <BreadcrumbContext.Provider value={{ trail, setTrail }}>{children}</BreadcrumbContext.Provider>;
};

export function useBreadcrumbContext() {
  return useContext(BreadcrumbContext);
}

/**
 * Cho phép trang chi tiết (:id) đẩy nhãn thực tế (VD: mã lớp, mã môn) lên thanh Breadcrumb dùng chung
 * thay vì vẽ thanh breadcrumb thứ hai bên trong trang.
 */
export function useBreadcrumbTrail(items: BreadcrumbCrumb[]) {
  const { setTrail } = useBreadcrumbContext();
  const key = items.map((i) => `${i.label}::${i.to || ''}`).join('|');

  useEffect(() => {
    setTrail(items);
    return () => setTrail([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, setTrail]);
}
