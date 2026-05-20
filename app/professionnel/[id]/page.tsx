"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AppNav } from "@/components/AppNav";
import {
  Badge,
  EmptyState,
  buttonClass,
  getAssignmentRequestStatus,
  tableBodyClass,
  tableCellClass,
  tableClass,
  tableHeadCellClass,
  tableHeaderClass,
  tableRowClass,
} from "@/components/Ui";
import { supabase } from "@/lib/supabaseClient";

type Profile = {
  id: string;
  full_name: string | null;
  email: string | null;
  pref_client_types: string[] | null;
  pref_modalities: string[] | null;
  pref_followup_types: string[] | null;
  pref_notes: string | null;
};

type AssignmentRequest = {
  professional_id: string;
  is_active: boolean | null;
  requested_count: number | null;
  assigned_count: number | null;
  remaining_count: number | null;
  request_comment: string | null;
};

type AssignedClient = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  contacted: boolean | null;
  is_active: boolean | null;
  meeting_count: number | null;
  dossier_closed: boolean | null;
  short_comment: string | null;
};

type NewAssignedClientForm = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  requester_name: string;
  short_comment: string;
};

type ProfessionalProfileForm = {
  full_name: string;
  email: string;
  pref_client_types: string;
  pref_modalities: string;
  pref_followup_types: string;
  pref_notes: string;
};

const emptyClientForm: NewAssignedClientForm = {
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  requester_name: "",
  short_comment: "",
};

const emptyProfessionalProfileForm: ProfessionalProfileForm = {
  full_name: "",
  email: "",
  pref_client_types: "",
  pref_modalities: "",
  pref_followup_types: "",
  pref_notes: "",
};

function formatBoolean(value: boolean | null): string {
  return value ? "Oui" : "Non";
}

function formatText(value: string | string[] | null | undefined): string {
  if (Array.isArray(value)) {
    const joinedValue = value
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .join(", ");

    return joinedValue || "-";
  }

  return value?.trim() || "-";
}

function getClientName(client: AssignedClient): string {
  const fullName = [client.first_name, client.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");

  return fullName || "-";
}

function nullableText(value: string): string | null {
  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}

function arrayToTextareaValue(value: string[] | null): string {
  return value?.join(", ") ?? "";
}

function textareaValueToArray(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function getTodayDate(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
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
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const professionalIdRaw = params?.id;
  const professionalId =
    typeof professionalIdRaw === "string"
      ? professionalIdRaw
      : Array.isArray(professionalIdRaw)
        ? professionalIdRaw[0]
        : "";

  const [profile, setProfile] = useState<Profile | null>(null);
  const [assignmentRequest, setAssignmentRequest] =
    useState<AssignmentRequest | null>(null);
  const [assignedClients, setAssignedClients] = useState<AssignedClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [professionalProfileForm, setProfessionalProfileForm] =
    useState<ProfessionalProfileForm>(emptyProfessionalProfileForm);
  const [savingProfessionalProfile, setSavingProfessionalProfile] =
    useState(false);
  const [professionalProfileMessage, setProfessionalProfileMessage] =
    useState<string | null>(null);
  const [professionalProfileError, setProfessionalProfileError] =
    useState<string | null>(null);
  const [clientForm, setClientForm] =
    useState<NewAssignedClientForm>(emptyClientForm);
  const [savingClient, setSavingClient] = useState(false);
  const [clientMessage, setClientMessage] = useState<string | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);

  const professionalName = useMemo(
    () => profile?.full_name?.trim() || "Professionnel",
    [profile],
  );
  const assignmentRequestStatus = useMemo(
    () =>
      getAssignmentRequestStatus({
        isActive: assignmentRequest?.is_active,
        remainingCount: assignmentRequest?.remaining_count,
        requestedCount: assignmentRequest?.requested_count,
      }),
    [assignmentRequest],
  );

  const loadProfessionalProfile = useCallback(
    async (options?: { showLoading?: boolean }) => {
      const showLoading = options?.showLoading ?? true;

      if (showLoading) {
        setLoading(true);
      }
      setError(null);
      let isRedirecting = false;

      try {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError || !user) {
          isRedirecting = true;
          router.push("/login");
          return;
        }

        const { data: currentProfile, error: currentProfileError } =
          await supabase
            .from("profiles")
            .select("role")
            .eq("id", user.id)
            .single();

        if (currentProfileError || currentProfile?.role !== "direction") {
          isRedirecting = true;
          router.push("/");
          return;
        }

        const profileResponse = await supabase
          .from("profiles")
          .select(
            "id, full_name, email, pref_client_types, pref_modalities, pref_followup_types, pref_notes",
          )
          .eq("id", professionalId)
          .single();

        if (profileResponse.error) throw profileResponse.error;

        const [requestResponse, clientsResponse] = await Promise.all([
          supabase
            .from("assignment_requests")
            .select(
              "professional_id, is_active, requested_count, assigned_count, remaining_count, request_comment",
            )
            .eq("professional_id", professionalId)
            .limit(1)
            .maybeSingle(),
          supabase
            .from("assigned_clients")
            .select(
              "id, first_name, last_name, contacted, is_active, meeting_count, dossier_closed, short_comment",
            )
            .eq("professional_id", professionalId)
            .order("last_name", { ascending: true }),
        ]);

        if (requestResponse.error) throw requestResponse.error;
        if (clientsResponse.error) throw clientsResponse.error;

        const loadedProfile = profileResponse.data as Profile;

        setProfile(loadedProfile);
        setProfessionalProfileForm({
          full_name: loadedProfile.full_name ?? "",
          email: loadedProfile.email ?? "",
          pref_client_types: arrayToTextareaValue(loadedProfile.pref_client_types),
          pref_modalities: arrayToTextareaValue(loadedProfile.pref_modalities),
          pref_followup_types: arrayToTextareaValue(
            loadedProfile.pref_followup_types,
          ),
          pref_notes: loadedProfile.pref_notes ?? "",
        });
        setAssignmentRequest(
          (requestResponse.data as AssignmentRequest | null) ?? null,
        );
        setAssignedClients((clientsResponse.data ?? []) as AssignedClient[]);
      } catch (caughtError: unknown) {
        setError(getErrorMessage(caughtError));
      } finally {
        if (showLoading && !isRedirecting) {
          setLoading(false);
        }
      }
    },
    [professionalId, router],
  );

  useEffect(() => {
    let cancelled = false;

    if (!professionalId) {
      setError("ID manquant dans l'URL.");
      setLoading(false);
      return;
    }

    async function loadInitialData() {
      await loadProfessionalProfile();

      if (cancelled) {
        return;
      }
    }

    loadInitialData();

    return () => {
      cancelled = true;
    };
  }, [loadProfessionalProfile, professionalId]);

  const handleClientFormChange = (
    field: keyof NewAssignedClientForm,
    value: string,
  ) => {
    setClientForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
  };

  const handleProfessionalProfileFormChange = (
    field: keyof ProfessionalProfileForm,
    value: string,
  ) => {
    setProfessionalProfileForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
  };

  const handleSaveProfessionalProfile = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    setProfessionalProfileMessage(null);
    setProfessionalProfileError(null);
    setSavingProfessionalProfile(true);

    try {
      const { data: updatedProfile, error: updateError } = await supabase
        .from("profiles")
        .update({
          full_name: nullableText(professionalProfileForm.full_name),
          email: nullableText(professionalProfileForm.email),
          pref_client_types: textareaValueToArray(
            professionalProfileForm.pref_client_types,
          ),
          pref_modalities: textareaValueToArray(
            professionalProfileForm.pref_modalities,
          ),
          pref_followup_types: textareaValueToArray(
            professionalProfileForm.pref_followup_types,
          ),
          pref_notes: nullableText(professionalProfileForm.pref_notes),
        })
        .eq("id", professionalId)
        .select(
          "id, full_name, email, pref_client_types, pref_modalities, pref_followup_types, pref_notes",
        )
        .single();

      if (updateError) throw updateError;

      const nextProfile = updatedProfile as Profile;
      setProfile(nextProfile);
      setProfessionalProfileForm({
        full_name: nextProfile.full_name ?? "",
        email: nextProfile.email ?? "",
        pref_client_types: arrayToTextareaValue(nextProfile.pref_client_types),
        pref_modalities: arrayToTextareaValue(nextProfile.pref_modalities),
        pref_followup_types: arrayToTextareaValue(
          nextProfile.pref_followup_types,
        ),
        pref_notes: nextProfile.pref_notes ?? "",
      });
      setProfessionalProfileMessage("Informations sauvegardees.");
    } catch (caughtError: unknown) {
      setProfessionalProfileError(getErrorMessage(caughtError));
    } finally {
      setSavingProfessionalProfile(false);
    }
  };

  const handleAssignClient = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setClientMessage(null);
    setClientError(null);

    const firstName = clientForm.first_name.trim();
    const lastName = clientForm.last_name.trim();

    if (!firstName || !lastName) {
      setClientError("Le prenom et le nom sont obligatoires.");
      return;
    }

    setSavingClient(true);

    try {
      const { error: insertError } = await supabase.from("assigned_clients").insert({
        professional_id: professionalId,
        first_name: firstName,
        last_name: lastName,
        email: nullableText(clientForm.email),
        phone: nullableText(clientForm.phone),
        requester_name: nullableText(clientForm.requester_name),
        short_comment: nullableText(clientForm.short_comment),
        assigned_date: getTodayDate(),
        contacted: false,
        is_active: false,
        dossier_closed: false,
        closure_reason: null,
        meeting_count: 0,
      });

      if (insertError) throw insertError;

      if (assignmentRequest) {
        const requestedCount = assignmentRequest.requested_count ?? 0;
        const nextAssignedCount = (assignmentRequest.assigned_count ?? 0) + 1;
        const nextRemainingCount = Math.max(
          requestedCount - nextAssignedCount,
          0,
        );

        const { data: updatedRequest, error: updateError } = await supabase
          .from("assignment_requests")
          .update({
            assigned_count: nextAssignedCount,
            remaining_count: nextRemainingCount,
          })
          .eq("professional_id", professionalId)
          .select(
            "professional_id, is_active, requested_count, assigned_count, remaining_count, request_comment",
          )
          .maybeSingle();

        if (updateError) throw updateError;

        setAssignmentRequest(
          (updatedRequest as AssignmentRequest | null) ?? {
            ...assignmentRequest,
            assigned_count: nextAssignedCount,
            remaining_count: nextRemainingCount,
          },
        );
      }

      setClientForm(emptyClientForm);
      setClientMessage("Client assigne avec succes.");
      await loadProfessionalProfile({ showLoading: false });
    } catch (caughtError: unknown) {
      setClientError(getErrorMessage(caughtError));
    } finally {
      setSavingClient(false);
    }
  };

  return (
    <>
      <AppNav />
      <main className="min-h-screen px-4 py-8 sm:px-6 lg:ml-72 lg:px-10">
        <div className="mx-auto max-w-7xl">
          <div className="mb-8">
            <p className="text-sm font-medium text-[#9b6a3d]">Profil operationnel</p>
            <h1 className="mt-1 text-3xl font-semibold text-[#332820]">
              {professionalName}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#7a6859]">
              Vue de consultation et d&apos;assignation pour la direction.
            </p>
          </div>

        {loading && (
          <div className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 text-sm text-[#7a6859]">
            Chargement des donnees...
          </div>
        )}

        {!loading && error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
            Erreur: {error}
          </div>
        )}

        {!loading && !error && profile && (
          <div className="space-y-6">
            <section className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-6 shadow-[0_1px_2px_rgba(72,49,30,0.06)]">
              <div>
                <h2 className="text-lg font-semibold text-[#332820]">
                  Informations du professionnel
                </h2>
                <p className="mt-1 text-sm text-[#7a6859]">
                  Modifier les informations non sensibles du profil existant.
                </p>
              </div>

              <form
                onSubmit={handleSaveProfessionalProfile}
                className="mt-5 space-y-4"
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block text-sm font-medium text-[#5d4a3d]">
                    Nom complet
                    <input
                      type="text"
                      value={professionalProfileForm.full_name}
                      onChange={(event) =>
                        handleProfessionalProfileFormChange(
                          "full_name",
                          event.target.value,
                        )
                      }
                      className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                    />
                  </label>

                  <label className="block text-sm font-medium text-[#5d4a3d]">
                    Email
                    <input
                      type="email"
                      value={professionalProfileForm.email}
                      onChange={(event) =>
                        handleProfessionalProfileFormChange(
                          "email",
                          event.target.value,
                        )
                      }
                      className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                    />
                  </label>

                  <label className="block text-sm font-medium text-[#5d4a3d]">
                    Clienteles souhaitees
                    <textarea
                      value={professionalProfileForm.pref_client_types}
                      onChange={(event) =>
                        handleProfessionalProfileFormChange(
                          "pref_client_types",
                          event.target.value,
                        )
                      }
                      rows={3}
                      className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                    />
                  </label>

                  <label className="block text-sm font-medium text-[#5d4a3d]">
                    Modalites souhaitees
                    <textarea
                      value={professionalProfileForm.pref_modalities}
                      onChange={(event) =>
                        handleProfessionalProfileFormChange(
                          "pref_modalities",
                          event.target.value,
                        )
                      }
                      rows={3}
                      className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                    />
                  </label>

                  <label className="block text-sm font-medium text-[#5d4a3d]">
                    Types de suivis souhaites
                    <textarea
                      value={professionalProfileForm.pref_followup_types}
                      onChange={(event) =>
                        handleProfessionalProfileFormChange(
                          "pref_followup_types",
                          event.target.value,
                        )
                      }
                      rows={3}
                      className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                    />
                  </label>

                  <label className="block text-sm font-medium text-[#5d4a3d]">
                    Notes / precisions
                    <textarea
                      value={professionalProfileForm.pref_notes}
                      onChange={(event) =>
                        handleProfessionalProfileFormChange(
                          "pref_notes",
                          event.target.value,
                        )
                      }
                      rows={3}
                      className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                    />
                  </label>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <button
                    type="submit"
                    disabled={savingProfessionalProfile}
                    className={buttonClass("primary")}
                  >
                    {savingProfessionalProfile
                      ? "Sauvegarde..."
                      : "Sauvegarder"}
                  </button>

                  {professionalProfileMessage && (
                    <p className="text-sm font-medium text-green-700">
                      {professionalProfileMessage}
                    </p>
                  )}

                  {professionalProfileError && (
                    <p className="text-sm font-medium text-red-700">
                      {professionalProfileError}
                    </p>
                  )}
                </div>
              </form>
            </section>

            <section className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-6 shadow-[0_1px_2px_rgba(72,49,30,0.06)]">
              <h2 className="text-lg font-semibold text-[#332820]">
                Apercu du professionnel
              </h2>
              <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-sm font-medium text-[#8a6f5d]">Nom complet</dt>
                  <dd className="mt-1 text-sm text-[#332820]">
                    {formatText(profile.full_name)}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-[#8a6f5d]">Email</dt>
                  <dd className="mt-1 text-sm text-[#332820]">
                    {formatText(profile.email)}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-6 shadow-[0_1px_2px_rgba(72,49,30,0.06)]">
              <h2 className="text-lg font-semibold text-[#332820]">
                Préférences d&apos;assignation
              </h2>
              <dl className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <dt className="text-sm font-medium text-[#8a6f5d]">
                    Clientèles souhaitées
                  </dt>
                  <dd className="mt-1 whitespace-pre-wrap text-sm text-[#332820]">
                    {formatText(profile.pref_client_types)}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-[#8a6f5d]">
                    Modalités souhaitées
                  </dt>
                  <dd className="mt-1 whitespace-pre-wrap text-sm text-[#332820]">
                    {formatText(profile.pref_modalities)}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-[#8a6f5d]">
                    Types de suivis souhaités
                  </dt>
                  <dd className="mt-1 whitespace-pre-wrap text-sm text-[#332820]">
                    {formatText(profile.pref_followup_types)}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-[#8a6f5d]">
                    Notes / précisions
                  </dt>
                  <dd className="mt-1 whitespace-pre-wrap text-sm text-[#332820]">
                    {formatText(profile.pref_notes)}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-6 shadow-[0_1px_2px_rgba(72,49,30,0.06)]">
              <h2 className="text-lg font-semibold text-[#332820]">
                Demande actuelle
              </h2>

              {assignmentRequest ? (
                <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                  <div>
                    <dt className="text-sm font-medium text-[#8a6f5d]">Statut</dt>
                    <dd className="mt-1">
                      <Badge tone={assignmentRequestStatus.tone}>
                        {assignmentRequestStatus.label}
                      </Badge>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-[#8a6f5d]">Demandes</dt>
                    <dd className="mt-1 text-sm text-[#332820]">
                      {assignmentRequest.requested_count ?? 0}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-[#8a6f5d]">Assignes</dt>
                    <dd className="mt-1 text-sm text-[#332820]">
                      {assignmentRequest.assigned_count ?? 0}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-[#8a6f5d]">Restants</dt>
                    <dd className="mt-1 text-sm text-[#332820]">
                      {assignmentRequest.remaining_count ?? 0}
                    </dd>
                  </div>
                  <div className="sm:col-span-2 lg:col-span-1">
                    <dt className="text-sm font-medium text-[#8a6f5d]">
                      Commentaire
                    </dt>
                    <dd className="mt-1 text-sm text-[#332820]">
                      {formatText(assignmentRequest.request_comment)}
                    </dd>
                  </div>
                </dl>
              ) : (
                <div className="mt-4">
                  <EmptyState title="Aucune demande actuelle pour ce professionnel." />
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-6 shadow-[0_1px_2px_rgba(72,49,30,0.06)]">
              <h2 className="text-lg font-semibold text-[#332820]">
                Nouvelle assignation
              </h2>

              <form onSubmit={handleAssignClient} className="mt-4 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <label className="block text-sm font-medium text-[#5d4a3d]">
                    Prenom
                    <input
                      type="text"
                      value={clientForm.first_name}
                      onChange={(event) =>
                        handleClientFormChange("first_name", event.target.value)
                      }
                      className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                      required
                    />
                  </label>

                  <label className="block text-sm font-medium text-[#5d4a3d]">
                    Nom
                    <input
                      type="text"
                      value={clientForm.last_name}
                      onChange={(event) =>
                        handleClientFormChange("last_name", event.target.value)
                      }
                      className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                      required
                    />
                  </label>

                  <label className="block text-sm font-medium text-[#5d4a3d]">
                    Email
                    <input
                      type="email"
                      value={clientForm.email}
                      onChange={(event) =>
                        handleClientFormChange("email", event.target.value)
                      }
                      className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                    />
                  </label>

                  <label className="block text-sm font-medium text-[#5d4a3d]">
                    Telephone
                    <input
                      type="tel"
                      value={clientForm.phone}
                      onChange={(event) =>
                        handleClientFormChange("phone", event.target.value)
                      }
                      className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                    />
                  </label>

                  <label className="block text-sm font-medium text-[#5d4a3d]">
                    Requerant
                    <input
                      type="text"
                      value={clientForm.requester_name}
                      onChange={(event) =>
                        handleClientFormChange(
                          "requester_name",
                          event.target.value,
                        )
                      }
                      className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                    />
                  </label>

                  <label className="block text-sm font-medium text-[#5d4a3d] sm:col-span-2 lg:col-span-3">
                    Commentaire court
                    <textarea
                      value={clientForm.short_comment}
                      onChange={(event) =>
                        handleClientFormChange(
                          "short_comment",
                          event.target.value,
                        )
                      }
                      rows={3}
                      className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                    />
                  </label>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <button
                    type="submit"
                    disabled={savingClient}
                    className={buttonClass("primary")}
                  >
                    {savingClient ? "Assignation..." : "Assigner le client"}
                  </button>

                  {clientMessage && (
                    <p className="text-sm font-medium text-green-700">
                      {clientMessage}
                    </p>
                  )}

                  {clientError && (
                    <p className="text-sm font-medium text-red-700">
                      {clientError}
                    </p>
                  )}
                </div>
              </form>
            </section>

            <section className="overflow-hidden rounded-2xl border border-[#eadfd2] bg-[#fffdf9] shadow-[0_1px_2px_rgba(72,49,30,0.06)]">
              <div className="border-b border-[#eadfd2] px-6 py-4">
                <h2 className="text-lg font-semibold text-[#332820]">
                  Clients assignes
                </h2>
              </div>

              {assignedClients.length === 0 ? (
                <div className="px-6 py-6">
                  <EmptyState title="Aucun client assigne pour ce professionnel." />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className={tableClass}>
                    <thead className={tableHeaderClass}>
                      <tr>
                        <th className={tableHeadCellClass}>
                          Client
                        </th>
                        <th className={tableHeadCellClass}>
                          Contacte
                        </th>
                        <th className={tableHeadCellClass}>
                          Actif
                        </th>
                        <th className={tableHeadCellClass}>
                          Rencontres
                        </th>
                        <th className={tableHeadCellClass}>
                          Dossier ferme
                        </th>
                        <th className={tableHeadCellClass}>
                          Commentaire
                        </th>
                      </tr>
                    </thead>
                    <tbody className={tableBodyClass}>
                      {assignedClients.map((client) => (
                        <tr key={client.id} className={tableRowClass}>
                          <td className="px-4 py-3 text-[#332820]">
                            {getClientName(client)}
                          </td>
                          <td className={tableCellClass}>
                            <Badge tone={client.contacted ? "success" : "muted"}>
                              {formatBoolean(client.contacted)}
                            </Badge>
                          </td>
                          <td className={tableCellClass}>
                            <Badge tone={client.is_active ? "success" : "warning"}>
                              {client.is_active ? "Service pris" : "Sans reponse"}
                            </Badge>
                          </td>
                          <td className={tableCellClass}>
                            {client.meeting_count ?? 0}
                          </td>
                          <td className={tableCellClass}>
                            <Badge tone={client.dossier_closed ? "neutral" : "muted"}>
                              {formatBoolean(client.dossier_closed)}
                            </Badge>
                          </td>
                          <td className={tableCellClass}>
                            {formatText(client.short_comment)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}
        </div>
      </main>
    </>
  );
}
