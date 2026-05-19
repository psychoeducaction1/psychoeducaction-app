"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
};

type AssignedClientRow = {
  id?: string;
  client_id?: string;
  client_name?: string | null;
  full_name?: string | null;
  email?: string | null;
  created_at?: string;
  [key: string]: unknown;
};

type AssignmentRequestRow = {
  id?: string;
  client_id?: string;
  client_name?: string | null;
  status?: string | null;
  created_at?: string;
  [key: string]: unknown;
};

function displayNameFromRow(row: Record<string, unknown>): string {
  const candidates = [
    row.client_name,
    row.full_name,
    row.name,
    row.email,
    row.client_id,
    row.id,
  ];
  const v = candidates.find((x) => typeof x === "string" && x.trim().length > 0);
  return typeof v === "string" ? v : "—";
}

function getErrorMessage(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return "Une erreur est survenue lors du chargement.";
}

export default function ProfessionnelDetailPage() {
  const params = useParams<{ id: string }>();
  const professionalIdRaw = params?.id;
  const professionalId =
    typeof professionalIdRaw === "string"
      ? professionalIdRaw
      : Array.isArray(professionalIdRaw)
        ? professionalIdRaw[0]
        : "";

  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [assignedClients, setAssignedClients] = useState<AssignedClientRow[]>([]);
  const [requests, setRequests] = useState<AssignmentRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fullName = useMemo(() => profile?.full_name ?? "Professionnel", [profile]);
  const email = useMemo(() => profile?.email ?? "—", [profile]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const { data: profileData, error: profileError } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .eq("id", professionalId)
          .single();

        if (profileError) throw profileError;
        if (!profileData) throw new Error("Professionnel introuvable.");

        const [{ data: assignedData, error: assignedError }, { data: requestsData, error: requestsError }] =
          await Promise.all([
            supabase
              .from("assigned_clients")
              .select("*")
              .eq("professional_id", professionalId),
            supabase
              .from("assignment_requests")
              .select("*")
              .eq("professional_id", professionalId),
          ]);

        if (assignedError) throw assignedError;
        if (requestsError) throw requestsError;

        if (cancelled) return;

        setProfile(profileData as ProfileRow);
        setAssignedClients((assignedData ?? []) as AssignedClientRow[]);
        setRequests((requestsData ?? []) as AssignmentRequestRow[]);
      } catch (e: unknown) {
        if (cancelled) return;
        setError(getErrorMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (!professionalId) {
      setLoading(false);
      setError("ID manquant dans l’URL.");
      return;
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [professionalId]);

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-4xl px-4 py-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">{fullName}</h1>
            <p className="mt-1 text-sm text-gray-600">{email}</p>
            <p className="mt-2 text-xs text-gray-500 break-all">ID: {professionalId}</p>
          </div>
        </div>

        <div className="mt-6">
          {loading ? (
            <div className="rounded-xl border border-gray-200 bg-white p-6">
              <p className="text-sm text-gray-700">Chargement…</p>
            </div>
          ) : error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-6">
              <p className="text-sm font-medium text-red-900">Erreur</p>
              <p className="mt-1 text-sm text-red-800">{error}</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-gray-200 bg-white p-6">
                  <p className="text-sm text-gray-600">Clients assignés</p>
                  <p className="mt-2 text-3xl font-semibold text-gray-900">
                    {assignedClients.length}
                  </p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-6">
                  <p className="text-sm text-gray-600">Demandes</p>
                  <p className="mt-2 text-3xl font-semibold text-gray-900">
                    {requests.length}
                  </p>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
                <section className="rounded-xl border border-gray-200 bg-white">
                  <div className="border-b border-gray-100 px-6 py-4">
                    <h2 className="text-sm font-semibold text-gray-900">
                      Liste des clients assignés
                    </h2>
                  </div>
                  <div className="px-6 py-4">
                    {assignedClients.length === 0 ? (
                      <p className="text-sm text-gray-600">Aucun client assigné.</p>
                    ) : (
                      <ul className="list-disc pl-5 text-sm text-gray-800 space-y-1">
                        {assignedClients.map((c, idx) => (
                          <li key={(typeof c.id === "string" && c.id) || `c-${idx}`}>
                            {displayNameFromRow(c)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </section>

                <section className="rounded-xl border border-gray-200 bg-white">
                  <div className="border-b border-gray-100 px-6 py-4">
                    <h2 className="text-sm font-semibold text-gray-900">
                      Liste des demandes
                    </h2>
                  </div>
                  <div className="px-6 py-4">
                    {requests.length === 0 ? (
                      <p className="text-sm text-gray-600">Aucune demande.</p>
                    ) : (
                      <ul className="list-disc pl-5 text-sm text-gray-800 space-y-1">
                        {requests.map((r, idx) => (
                          <li key={(typeof r.id === "string" && r.id) || `r-${idx}`}>
                            {displayNameFromRow(r)}
                            {typeof r.status === "string" && r.status.trim().length > 0 ? (
                              <span className="text-gray-500"> — {r.status}</span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </section>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
