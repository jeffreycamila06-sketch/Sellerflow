// Audit Batch B — fake/dead-display cleanup behavior tests.
//  #2 Admin home: real owner + real MRR, fake tiles gone
//  #3 Orders: dead filter chips removed
//  #4 Customers: search is a REAL input filtering the loaded pages
//  #5 Customers: Maria-demo comment archive removed (honest note)
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TProvider } from "../../i18n";
import Admin from "../Admin";
import Orders from "../Orders";
import Customers from "../Customers";
import { deriveMrr, filterCustomers } from "../../adapters/useReadData";
import type { User, Customer } from "../../data";

const wrap = (ui: React.ReactElement) => render(<TProvider lang="en">{ui}</TProvider>);

const user = (over: Partial<User>): User => ({
  email: "s@x.com", note: "", contactNote: "", role: "Seller", plan: "Basic", days: 10,
  accounts: "1", status: "active", planExpiry: "2099-01-01T00:00:00.000Z", planStatus: "active", ...over,
} as User);

describe("deriveMrr (#2 — real Monthly Revenue tile)", () => {
  it("sums real NT$ tier prices over ACTIVE paid plans only", () => {
    const users = [
      user({ plan: "Basic" }),                                  // 500
      user({ plan: "Pro" }),                                    // 1200
      user({ plan: "Master" }),                                 // 1700
      user({ plan: "Free" }),                                   // excluded (not paid)
      user({ plan: "Pro", status: "expired", planStatus: "expired", days: -3 }), // excluded (expired)
    ];
    expect(deriveMrr(users)).toBe(500 + 1200 + 1700);
  });
  it("no users → 0", () => {
    expect(deriveMrr([])).toBe(0);
  });
});

describe("Admin home (#2 — no fake displays left)", () => {
  const renderAdmin = (over: Partial<Parameters<typeof Admin>[0]> = {}) =>
    wrap(<Admin onOpenPanel={() => {}} cur="NT$" {...over} />);
  it("owner card shows the REAL signed-in admin, not Juan Dela Cruz", () => {
    renderAdmin({ owner: { name: "Jeffrey Camila", email: "camilajeffrey1@gmail.com" } });
    expect(screen.getByText("Jeffrey Camila")).toBeTruthy();
    expect(screen.queryByText("Juan Dela Cruz")).toBeNull();
  });
  it("Monthly Revenue shows real MRR when live, em dash otherwise", () => {
    renderAdmin({ mrr: 12900 });
    expect(screen.getByText("NT$12,900")).toBeTruthy();
    expect(screen.queryByText(/4\.2M/)).toBeNull();
  });
  it("bell badge '5' and 'Systems OK' chip are gone", () => {
    renderAdmin();
    expect(screen.queryByText("5")).toBeNull();
    expect(screen.queryByText(/Systems OK/i)).toBeNull();
  });
});

describe("Orders (#3 — dead filter chips removed)", () => {
  it("no Unpaid/Paid/Shipped chips; the real count lives in the header badge", () => {
    wrap(<Orders onGoPrint={() => {}} cur="NT$" state="live" orders={[
      { id: "#1", buyer: "Ann", handle: "@ann", items: "Dress", qty: 1, total: 150, status: "New", platform: "TikTok", time: "9:41 PM" },
    ]} />);
    expect(screen.queryByText(/Unpaid/)).toBeNull();
    expect(screen.queryByText(/Shipped/)).toBeNull();
    expect(screen.getByText(/Today · 1/)).toBeTruthy();
  });
});

const cust = (name: string, handle: string): Customer =>
  ({ name, handle, orders: 2, spent: 500, last: "1h", platform: "TikTok" });

describe("filterCustomers (#4 — pure search core)", () => {
  const list = [cust("Ann Cruz", "@anncruz"), cust("Bob Tan", "@bobby")];
  it("case-insensitive contains on name + handle; empty query = all", () => {
    expect(filterCustomers(list, "ann")).toHaveLength(1);
    expect(filterCustomers(list, "BOBBY")).toHaveLength(1);
    expect(filterCustomers(list, "")).toHaveLength(2);
    expect(filterCustomers(list, "zzz")).toHaveLength(0);
  });
});

describe("Customers (#4 search input + #5 archive demo removed)", () => {
  const list = [cust("Ann Cruz", "@anncruz"), cust("Bob Tan", "@bobby")];
  it("typing in the search input filters the loaded list", () => {
    wrap(<Customers cur="NT$" customers={list} state="live" />);
    expect(screen.getByText("Bob Tan")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/Search loaded customers/), { target: { value: "ann" } });
    expect(screen.getByText("Ann Cruz")).toBeTruthy();
    expect(screen.queryByText("Bob Tan")).toBeNull();
  });
  it("no-match note when the query hits nothing", () => {
    wrap(<Customers cur="NT$" customers={list} state="live" />);
    fireEvent.change(screen.getByPlaceholderText(/Search loaded customers/), { target: { value: "zzz" } });
    expect(screen.getByText(/No match in the loaded customers/)).toBeTruthy();
  });
  it("Maria-demo comment archive is gone; honest note renders instead", () => {
    wrap(<Customers cur="NT$" customers={list} state="live" />);
    expect(screen.queryByText("Maria Santos")).toBeNull();
    expect(screen.queryByText(/Mine! Red lipstick/)).toBeNull();
    expect(screen.getByText(/Comment history isn't stored yet/)).toBeTruthy();
  });
});
