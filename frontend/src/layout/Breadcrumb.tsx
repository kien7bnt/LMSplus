import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { IconChevronRight } from '../teaching/components/Icons';
import { UserRole } from '../types/elearning';
import { useBreadcrumbContext } from './BreadcrumbContext';
import { resolveBreadcrumbs } from './navigationConfig';

export const Breadcrumb: React.FC<{ roles: UserRole[] }> = ({ roles }) => {
  const location = useLocation();
  const { trail } = useBreadcrumbContext();
  const crumbs = resolveBreadcrumbs(location.pathname, location.search, roles, trail);

  if (crumbs.length === 0) return null;

  return (
    <nav className="saas-breadcrumb" aria-label="Đường dẫn trang hiện tại">
      <ol className="saas-breadcrumb__list">
        {crumbs.map((crumb, idx) => {
          const isLast = idx === crumbs.length - 1;
          return (
            <li key={`${crumb.label}-${idx}`} className="saas-breadcrumb__item">
              {idx > 0 && (
                <span className="saas-breadcrumb__sep" aria-hidden="true">
                  <IconChevronRight size={13} />
                </span>
              )}
              {crumb.to && !isLast ? (
                <Link to={crumb.to} className="saas-breadcrumb__link" title={crumb.label}>
                  {crumb.label}
                </Link>
              ) : (
                <span
                  className="saas-breadcrumb__current"
                  aria-current={isLast ? 'page' : undefined}
                  title={crumb.label}
                >
                  {crumb.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
