import { useState, useEffect, useCallback } from "react";
import { usePageHeader } from "../store/PageHeaderContext.jsx";
import { useAuth } from "../store/AuthContext.jsx";
import { useStation } from "../store/StationContext.jsx";
import * as storesApi from "../api/stores.js";


export default function StoresPage() {
  const { hasPermission } = useAuth();
  const { stationId } = useStation();
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const canIssue = hasPermission("store", "issue");

  usePageHeader({ title: "Stores", subtitle: "AMD · Inventory" });

  const load = useCallback(() => {
    if (!stationId) return;
    storesApi.listStoreItems(stationId).then(setItems).catch(err => setError(err.message));
  }, [stationId]);
  useEffect(() => { load(); }, [load]);

  async function handleMovement(item, direction) {
    const qtyStr = prompt(`${direction === "IN" ? "Receive" : "Issue"} how many ${item.unit} of ${item.partNo}?`);
    const quantity = parseInt(qtyStr, 10);
    if (!quantity || quantity <= 0) return;
    const reference = prompt("Reference (work order / GRN, optional):") || undefined;
    try {
      await storesApi.recordMovement(item.id, { direction, quantity, reference });
      load();
    } catch (err) {
      alert(`Failed: ${err.message}`);
    }
  }

  if (error) return <div className="ab red">{error}</div>;
  if (!items) return <div className="card">Loading stores…</div>;

  return (
    <div className="card">
      <div className="card-title">Store Items <span className="tag">{items.length}</span></div>
      <table className="rt" style={{ width: "100%" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Part No.</th>
            <th style={{ textAlign: "left" }}>Description</th>
            <th>On Hand</th>
            <th>Min Level</th>
            <th>Unit</th>
            {canIssue && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {items.map(item => {
            const low = item.quantityOnHand < item.minStockLevel;
            return (
              <tr key={item.id}>
                <td style={{ textAlign: "left", padding: "6px 4px" }}>{item.partNo}</td>
                <td style={{ textAlign: "left" }}>{item.description}</td>
                <td style={{ fontWeight: 700, color: low ? "var(--rp-red)" : "inherit" }}>{item.quantityOnHand}</td>
                <td>{item.minStockLevel}</td>
                <td>{item.unit}</td>
                {canIssue && (
                  <td>
                    <button className="btn btn-ghost btn-sm" onClick={() => handleMovement(item, "IN")}>+ Receive</button>
                    <button className="btn btn-ghost btn-sm" style={{ marginLeft: 4 }} onClick={() => handleMovement(item, "OUT")}>− Issue</button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
