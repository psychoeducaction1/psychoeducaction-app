"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useParams, useRouter } from "next/navigation";
import { AppNav } from "@/components/AppNav";
import {
  AlertBanner,
  Badge,
  type BadgeTone,
  buttonClass,
  EmptyState,
  getAssignmentRequestStatus,
  SectionCard,
  StatCard,
  tableBodyClass,
  tableCellClass,
  tableClass,
  tableHeadCellClass,
  tableHeaderClass,
  tableRowClass,
  tableShellClass,
} from "@/components/ui/index";
import { supabase } from "@/lib/supabaseClient";
import {
  getAssignmentRequestMetrics,
  getRemainingAssignmentCount,
} from "../shared";

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
  id: string;
  professional_id: string;
  is_active: boolean | null;
  requested_count: number | null;
  assigned_count: number | null;
  remaining_count: number | null;
  request_comment: string | null;
  created_at?: string | null;
};

type AssignedClient = {
  id: string;
  assignment_request_id: string | null;
  first_name: string | null;
  last_name: string | null;
  assigned_date: string | null;
  contacted: boolean | null;
  is_active: boolean | null;
  meeting_count: number | null;
  dossier_closed: boolean | null;
  closure_reason: string | null;
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

const HISTORY_PAGE_SIZE = 5;

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

function getServiceStatus(client: AssignedClient): {
  label: string;
  tone: BadgeTone;
} {
  if (client.is_active === true) {
    return { label: "Service pris", tone: "success" };
  }

  if (client.is_active === false) {
    return { label: "Service non pris", tone: "danger" };
  }

  return { label: "En attente", tone: "warning" };
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

function formatDate(value: string | null): string {
  if (!value) return "-";

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("fr-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
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
  const [historicalClients, setHistoricalClients] = useState<AssignedClient[]>(
    [],
  );
  const [showClientHistory, setShowClientHistory] = useState(false);
  const [clientHistoryPage, setClientHistoryPage] = useState(0);
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
  const [savingClientMotifIds, setSavingClientMotifIds] = useState<
    Record<string, boolean>
  >({});
  const [clientMotifMessages, setClientMotifMessages] = useState<
    Record<string, string>
  >({});
  const [clientMotifErrors, setClientMotifErrors] = useState<
    Record<string, string>
  >({});

  const professionalName = useMemo(
    () => profile?.full_name?.trim() || "Professionnel",
    [profile],
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
            .limit(1)
            .maybeSingle();

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
          .limit(1)
          .maybeSingle();

        if (profileResponse.error) throw profileResponse.error;
        if (!profileResponse.data) {
          throw new Error("Profil professionnel introuvable.");
        }

        const [requestsResponse, clientsResponse] = await Promise.all([
          supabase
            .from("assignment_requests")
            .select(
              "id, professional_id, is_active, requested_count, assigned_count, remaining_count, request_comment, created_at",
            )
            .eq("professional_id", professionalId)
            .order("created_at", { ascending: false }),
          supabase
            .from("assigned_clients")
            .select(
              "id, assignment_request_id, first_name, last_name, assigned_date, contacted, is_active, meeting_count, dossier_closed, closure_reason, short_comment",
            )
            .eq("professional_id", professionalId)
            .order("assigned_date", { ascending: false }),
        ]);

        if (requestsResponse.error) throw requestsResponse.error;
        if (clientsResponse.error) throw clientsResponse.error;

        const loadedRequests =
          (requestsResponse.data ?? []) as AssignmentRequest[];
        const loadedClients = (clientsResponse.data ?? []) as AssignedClient[];
        const clientsByRequestId = new Map<string, AssignedClient[]>();

        loadedClients.forEach((client) => {
          if (!client.assignment_request_id) return;

          const requestClients =
            clientsByRequestId.get(client.assignment_request_id) ?? [];
          requestClients.push(client);
          clientsByRequestId.set(client.assignment_request_id, requestClients);
        });

        const activeRequest =
          loadedRequests.find((request) => {
            const requestAssignedCount =
              clientsByRequestId.get(request.id)?.length ?? 0;
            return getAssignmentRequestMetrics({
              isActive: request.is_active,
              requestedCount: request.requested_count,
              acceptedCount: requestAssignedCount,
              remainingCount: request.remaining_count,
            }).isActive;
          }) ?? null;
        const activeRequestClients = activeRequest
          ? clientsByRequestId.get(activeRequest.id) ?? []
          : [];

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
        setAssignmentRequest(activeRequest);
        setAssignedClients(activeRequestClients);
        setHistoricalClients(loadedClients);
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

  useEffect(() => {
    setClientHistoryPage(0);
  }, [historicalClients.length, showClientHistory]);

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

  const handleClientMotifChange = (clientId: string, value: string) => {
    setAssignedClients((currentClients) =>
      currentClients.map((client) =>
        client.id === clientId ? { ...client, short_comment: value } : client,
      ),
    );
    setHistoricalClients((currentClients) =>
      currentClients.map((client) =>
        client.id === clientId ? { ...client, short_comment: value } : client,
      ),
    );
    setClientMotifMessages((currentMessages) => ({
      ...currentMessages,
      [clientId]: "",
    }));
    setClientMotifErrors((currentErrors) => ({
      ...currentErrors,
      [clientId]: "",
    }));
  };

  const handleSaveClientMotif = async (client: AssignedClient) => {
    setSavingClientMotifIds((currentIds) => ({
      ...currentIds,
      [client.id]: true,
    }));
    setClientMotifMessages((currentMessages) => ({
      ...currentMessages,
      [client.id]: "",
    }));
    setClientMotifErrors((currentErrors) => ({
      ...currentErrors,
      [client.id]: "",
    }));

    try {
      const { error: updateError } = await supabase
        .from("assigned_clients")
        .update({ short_comment: nullableText(client.short_comment ?? "") })
        .eq("id", client.id)
        .eq("professional_id", professionalId);

      if (updateError) throw updateError;

      setAssignedClients((currentClients) =>
        currentClients.map((currentClient) =>
          currentClient.id === client.id
            ? {
                ...currentClient,
                short_comment: nullableText(client.short_comment ?? ""),
              }
            : currentClient,
        ),
      );
      setHistoricalClients((currentClients) =>
        currentClients.map((currentClient) =>
          currentClient.id === client.id
            ? {
                ...currentClient,
                short_comment: nullableText(client.short_comment ?? ""),
              }
            : currentClient,
        ),
      );
      setClientMotifMessages((currentMessages) => ({
        ...currentMessages,
        [client.id]: "Motif sauvegardé.",
      }));
    } catch (caughtError: unknown) {
      setClientMotifErrors((currentErrors) => ({
        ...currentErrors,
        [client.id]: getErrorMessage(caughtError),
      }));
    } finally {
      setSavingClientMotifIds((currentIds) => ({
        ...currentIds,
        [client.id]: false,
      }));
    }
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
        .limit(1)
        .maybeSingle();

      if (updateError) throw updateError;
      if (!updatedProfile) {
        throw new Error("Profil professionnel introuvable.");
      }

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
      setProfessionalProfileMessage("Informations sauvegardées.");
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
      setClientError("Le prénom et le nom sont obligatoires.");
      return;
    }

    if (!assignmentRequest) {
      setClientError(
        "Aucune demande active avec place restante pour ce professionnel.",
      );
      return;
    }

    const currentRequestMetrics = getAssignmentRequestMetrics({
      isActive: assignmentRequest.is_active,
      requestedCount: assignmentRequest.requested_count,
      acceptedCount: assignedClients.length,
      remainingCount: assignmentRequest.remaining_count,
    });

    if (!currentRequestMetrics.isActive) {
      setClientError(
        "La demande actuelle est complétée. Aucune place restante à assigner.",
      );
      return;
    }

    setSavingClient(true);

    try {
      const { error: insertError } = await supabase.from("assigned_clients").insert({
        assignment_request_id: assignmentRequest.id,
        professional_id: professionalId,
        first_name: firstName,
        last_name: lastName,
        email: nullableText(clientForm.email),
        phone: nullableText(clientForm.phone),
        requester_name: nullableText(clientForm.requester_name),
        short_comment: nullableText(clientForm.short_comment),
        assigned_date: getTodayDate(),
        contacted: false,
        is_active: null,
        dossier_closed: false,
        closure_reason: null,
        meeting_count: 0,
      });

      if (insertError) throw insertError;

      if (assignmentRequest) {
        const requestedCount = assignmentRequest.requested_count ?? 0;
        const nextAssignedCount = assignedClients.length + 1;
        const nextRemainingCount = getRemainingAssignmentCount(
          requestedCount,
          nextAssignedCount,
        );

        const { data: updatedRequest, error: updateError } = await supabase
          .from("assignment_requests")
          .update({
            assigned_count: nextAssignedCount,
            remaining_count: nextRemainingCount,
          })
          .eq("id", assignmentRequest.id)
          .select(
            "id, professional_id, is_active, requested_count, assigned_count, remaining_count, request_comment",
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
      setClientMessage("Client assigné avec succès.");
      await loadProfessionalProfile({ showLoading: false });
    } catch (caughtError: unknown) {
      setClientError(getErrorMessage(caughtError));
    } finally {
      setSavingClient(false);
    }
  };

  const clientsWithService = assignedClients.filter(
    (client) => client.is_active === true,
  );
  const clientsPendingService = assignedClients.filter(
    (client) => client.is_active === null,
  );
  const requestMetrics = getAssignmentRequestMetrics({
    isActive: assignmentRequest?.is_active,
    requestedCount: assignmentRequest?.requested_count,
    acceptedCount: assignedClients.length,
    remainingCount: assignmentRequest?.remaining_count,
  });
  const requestedCount = requestMetrics.requestedCount;
  const assignedCount = requestMetrics.acceptedCount;
  const remainingCount = requestMetrics.isActive
    ? requestMetrics.remainingCount
    : 0;
  const assignmentRequestStatus = getAssignmentRequestStatus({
    isActive: requestMetrics.isActive,
    remainingCount,
    requestedCount,
  });
  const displayAssignmentRequest = requestMetrics.isActive
    ? assignmentRequest
    : null;
  const clientHistoryPageCount = Math.ceil(
    historicalClients.length / HISTORY_PAGE_SIZE,
  );
  const paginatedHistoricalClients = historicalClients.slice(
    clientHistoryPage * HISTORY_PAGE_SIZE,
    clientHistoryPage * HISTORY_PAGE_SIZE + HISTORY_PAGE_SIZE,
  );
  const operationalAlerts = [
    clientsPendingService.length > 0
      ? {
          title: "Assignations en attente",
          description: `${clientsPendingService.length} assignation${
            clientsPendingService.length > 1 ? "s sont" : " est"
          } en attente de confirmation de service.`,
          tone: "warning" as BadgeTone,
        }
      : null,
    assignmentRequestStatus.label === "demande inactive"
      ? {
          title: "Demande inactive",
          description: "Ce professionnel n'a pas de demande active actuellement.",
          tone: "muted" as BadgeTone,
        }
      : null,
    clientsWithService.length === 0
      ? {
          title: "Aucun client ayant pris le service",
          description: "Aucun client actif n'est associé au professionnel.",
          tone: "muted" as BadgeTone,
        }
      : null,
  ].filter(
    (
      alert,
    ): alert is { title: string; description: string; tone: BadgeTone } =>
      Boolean(alert),
  );

  return (
    <>
      <AppNav />
      <main className="min-h-screen px-4 py-8 sm:px-6 lg:ml-72 lg:px-10">
        <div className="mx-auto max-w-7xl">
          {loading && (
            <div className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 text-sm text-[#7a6859]">
              Chargement des données...
            </div>
          )}

          {!loading && error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
              Erreur: {error}
            </div>
          )}

          {!loading && !error && profile && (
            <div className="space-y-8">
              <section className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 shadow-[0_1px_2px_rgba(72,49,30,0.05)]">
                <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-sm font-medium text-[#9b6a3d]">
                      Fiche operationnelle
                    </p>
                    <h1 className="mt-2 text-3xl font-semibold text-[#332820]">
                      {professionalName}
                    </h1>
                    <p className="mt-2 text-sm text-[#7a6859]">
                      {formatText(profile.email)}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    {displayAssignmentRequest && (
                      <Badge tone={assignmentRequestStatus.tone}>
                        {assignmentRequestStatus.label}
                      </Badge>
                    )}
                    <Badge tone={remainingCount > 0 ? "warning" : "muted"}>
                      {remainingCount} place{remainingCount > 1 ? "s" : ""} restante
                      {remainingCount > 1 ? "s" : ""}
                    </Badge>
                    <Badge tone="success">
                      {clientsWithService.length} service
                      {clientsWithService.length > 1 ? "s" : ""} pris
                    </Badge>
                    <Badge tone="warning">
                      {clientsPendingService.length} en attente
                    </Badge>
                  </div>
                </div>
              </section>

              <SectionCard
                title="Resume"
                description="Vue rapide des volumes, de la demande et des points à surveiller."
              >
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  <StatCard
                    label="Clients ayant pris le service"
                    value={clientsWithService.length}
                    helper="Service pris = oui"
                  />
                  <StatCard
                    label="Nombre d’assignations restantes à faire"
                    value={remainingCount}
                    helper={
                      displayAssignmentRequest
                        ? `${assignedCount} services pris sur ${requestedCount}`
                        : "Aucune demande active"
                    }
                  />
                  {displayAssignmentRequest && (
                    <div className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 shadow-[0_1px_2px_rgba(72,49,30,0.06)]">
                      <p className="text-sm font-medium text-[#7a6859]">
                        Statut de la demande
                      </p>
                      <div className="mt-3">
                        <Badge tone={assignmentRequestStatus.tone}>
                          {assignmentRequestStatus.label}
                        </Badge>
                      </div>
                      <p className="mt-3 text-xs text-[#8a6f5d]">
                        {remainingCount} place{remainingCount > 1 ? "s" : ""} restante
                        {remainingCount > 1 ? "s" : ""}
                      </p>
                    </div>
                  )}
                </div>

                <div className="mt-5 grid gap-3 lg:grid-cols-2">
                  {operationalAlerts.length === 0 ? (
                    <EmptyState title="Aucune alerte operationnelle." />
                  ) : (
                    operationalAlerts.map((alert) => (
                      <AlertBanner
                        key={alert.title}
                        title={alert.title}
                        description={alert.description}
                        tone={alert.tone}
                      />
                    ))
                  )}
                </div>
              </SectionCard>

              <SectionCard
                title="Clients"
                description="Liste des clients assignés et ajout rapide d'une nouvelle assignation."
              >
                {assignedClients.length === 0 ? (
                  <EmptyState title="Aucun client assigné pour ce professionnel." />
                ) : (
                  <div className={tableShellClass}>
                    <table className={tableClass}>
                      <thead className={tableHeaderClass}>
                        <tr>
                          <th className={tableHeadCellClass}>Client</th>
                          <th className={tableHeadCellClass}>Service pris</th>
                          <th className={tableHeadCellClass}>Rencontres</th>
                          <th className={tableHeadCellClass}>Dossier ferme</th>
                          <th className={tableHeadCellClass}>
                            Motif de consultation
                          </th>
                        </tr>
                      </thead>
                      <tbody className={tableBodyClass}>
                        {assignedClients.map((client) => (
                          <tr key={client.id} className={tableRowClass}>
                            <td className="px-4 py-3 font-medium text-[#332820]">
                              {getClientName(client)}
                            </td>
                            <td className={tableCellClass}>
                              <Badge tone={getServiceStatus(client).tone}>
                                {getServiceStatus(client).label}
                              </Badge>
                            </td>
                            <td className={tableCellClass}>
                              {client.meeting_count ?? 0}
                            </td>
                            <td className={tableCellClass}>
                              <Badge
                                tone={client.dossier_closed ? "neutral" : "muted"}
                              >
                                {formatBoolean(client.dossier_closed)}
                              </Badge>
                            </td>
                            <td className="min-w-[18rem] px-4 py-3 align-top">
                              <textarea
                                value={client.short_comment ?? ""}
                                onChange={(event) =>
                                  handleClientMotifChange(
                                    client.id,
                                    event.target.value,
                                  )
                                }
                                rows={2}
                                className="w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                              />
                              <div className="mt-2 flex flex-col gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleSaveClientMotif(client)}
                                  disabled={savingClientMotifIds[client.id]}
                                  className={buttonClass("secondary")}
                                >
                                  {savingClientMotifIds[client.id]
                                    ? "Sauvegarde..."
                                    : "Sauvegarder le motif"}
                                </button>
                                {clientMotifMessages[client.id] && (
                                  <p className="text-xs font-medium text-green-700">
                                    {clientMotifMessages[client.id]}
                                  </p>
                                )}
                                {clientMotifErrors[client.id] && (
                                  <p className="text-xs font-medium text-red-700">
                                    {clientMotifErrors[client.id]}
                                  </p>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {displayAssignmentRequest ? (
                  <div className="mt-6 rounded-2xl border border-[#eadfd2] bg-[#fbf6ef] p-5">
                    <h3 className="text-base font-semibold text-[#332820]">
                      Nouvelle assignation
                    </h3>

                    <form onSubmit={handleAssignClient} className="mt-4 space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      <label className="block text-sm font-medium text-[#5d4a3d]">
                        Prénom
                        <input
                          type="text"
                          value={clientForm.first_name}
                          onChange={(event) =>
                            handleClientFormChange(
                              "first_name",
                              event.target.value,
                            )
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
                            handleClientFormChange(
                              "last_name",
                              event.target.value,
                            )
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
                        Téléphone
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
                        Requérant
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
                        Motif de consultation
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
                  </div>
                ) : null}
              </SectionCard>

              <SectionCard
                title="Historique client"
                description="Timeline récente générée à partir des clients assignés, incluant les anciennes demandes."
              >
                {historicalClients.length === 0 ? (
                  <EmptyState title="Aucun historique client à afficher." />
                ) : !showClientHistory ? (
                  <button
                    type="button"
                    className={buttonClass("secondary")}
                    onClick={() => setShowClientHistory(true)}
                  >
                    Voir l’historique client
                  </button>
                ) : (
                  <div className="space-y-4">
                    {paginatedHistoricalClients.map((client) => (
                      <article
                        key={client.id}
                        className="relative rounded-2xl border border-[#eadfd2] bg-[#fbf6ef] p-4 pl-11"
                      >
                        <span className="absolute left-4 top-5 h-3 w-3 rounded-full border-2 border-[#fffdf9] bg-[#8a5633] shadow-[0_0_0_3px_#eadfd2]" />

                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <h3 className="font-medium text-[#332820]">
                              {getClientName(client)}
                            </h3>
                            <p className="mt-1 text-sm text-[#7a6859]">
                              Assigné le {formatDate(client.assigned_date)}
                            </p>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <Badge tone={getServiceStatus(client).tone}>
                              {getServiceStatus(client).label}
                            </Badge>
                          </div>
                        </div>

                        {(client.closure_reason || client.short_comment) && (
                          <div className="mt-4 grid gap-3 md:grid-cols-2">
                            {client.closure_reason && (
                              <div className="rounded-xl border border-[#eadfd2] bg-[#fffdf9] p-3">
                                <p className="text-xs font-medium uppercase text-[#8a6f5d]">
                                  Motif de non-prise
                                </p>
                                <p className="mt-1 text-sm text-[#332820]">
                                  {formatText(client.closure_reason)}
                                </p>
                              </div>
                            )}

                            {client.short_comment && (
                              <div className="min-w-0 overflow-hidden rounded-xl border border-[#eadfd2] bg-[#fffdf9] p-3">
                                <p className="text-xs font-medium uppercase text-[#8a6f5d]">
                                  Motif de consultation
                                </p>
                                <p className="mt-1 max-w-full whitespace-pre-wrap break-words text-sm text-[#332820] [overflow-wrap:anywhere]">
                                  {formatText(client.short_comment)}
                                </p>
                              </div>
                            )}
                          </div>
                        )}
                      </article>
                    ))}
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-sm text-[#7a6859]">
                        Page {clientHistoryPage + 1} sur {clientHistoryPageCount}
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className={buttonClass("secondary")}
                          onClick={() =>
                            setClientHistoryPage((currentPage) =>
                              Math.max(currentPage - 1, 0),
                            )
                          }
                          disabled={clientHistoryPage === 0}
                        >
                          Précédent
                        </button>
                        <button
                          type="button"
                          className={buttonClass("secondary")}
                          onClick={() =>
                            setClientHistoryPage((currentPage) =>
                              Math.min(
                                currentPage + 1,
                                clientHistoryPageCount - 1,
                              ),
                            )
                          }
                          disabled={clientHistoryPage >= clientHistoryPageCount - 1}
                        >
                          Suivant
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </SectionCard>

              <SectionCard
                title="Demande"
                description="Demande actuelle transmise par le professionnel."
              >
                {displayAssignmentRequest ? (
                  <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <dt className="text-sm font-medium text-[#8a6f5d]">
                        Demandes
                      </dt>
                      <dd className="mt-1 text-sm text-[#332820]">
                        {requestedCount}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-[#8a6f5d]">
                        Services pris
                      </dt>
                      <dd className="mt-1 text-sm text-[#332820]">
                        {assignedCount}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-[#8a6f5d]">
                        Restants
                      </dt>
                      <dd className="mt-1 text-sm text-[#332820]">
                        {remainingCount}
                      </dd>
                    </div>
                    <div className="sm:col-span-2 lg:col-span-1">
                      <dt className="text-sm font-medium text-[#8a6f5d]">
                        Commentaire demande
                      </dt>
                      <dd className="mt-1 text-sm text-[#332820]">
                        {formatText(displayAssignmentRequest.request_comment)}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <EmptyState title="Aucune demande active actuellement." />
                )}
              </SectionCard>

              <SectionCard
                title="Préférences"
                description="Informations de préférence utiles au choix des assignations."
              >
                <dl className="grid gap-4 md:grid-cols-2">
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
              </SectionCard>

              <SectionCard
                title="Gestion"
                description="Modifier les informations non sensibles du profil professionnel existant."
              >
                <form
                  onSubmit={handleSaveProfessionalProfile}
                  className="space-y-4"
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
                      Clientèles souhaitées
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
                      Modalités souhaitées
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
                      Types de suivis souhaités
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
                      Notes / précisions
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
              </SectionCard>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
