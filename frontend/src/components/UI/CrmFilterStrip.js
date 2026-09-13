"use client";

import Link from "next/link";

export function CrmFilterStrip({ items, activeKey, onSelect, ariaLabel = "Filter" }) {
  return (
    <div className="crm-filter-strip" role="tablist" aria-label={ariaLabel}>
      {items.map((item) => {
        const active = activeKey != null && String(activeKey) === String(item.key);
        const className = `crm-filter-card${active ? " crm-filter-card--active" : ""}`;
        const style = item.color ? { borderTopColor: item.color } : undefined;
        const inner = (
          <>
            <span className="crm-filter-card__label">{item.label}</span>
            <strong className="crm-filter-card__count">{item.count ?? "—"}</strong>
          </>
        );
        if (item.href) {
          return (
            <Link key={item.key} href={item.href} className={className} style={style}>
              {inner}
            </Link>
          );
        }
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={active}
            className={className}
            style={style}
            onClick={() => (item.onClick ? item.onClick() : onSelect?.(item.key))}
          >
            {inner}
          </button>
        );
      })}
    </div>
  );
}
