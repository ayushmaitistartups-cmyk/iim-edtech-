"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { X, Trash2, MessageSquare, Clock } from "lucide-react";

interface ChatSession {
  id: string;
  title: string;
  mode: string;
  updated_at: string;
  created_at: string;
}

interface ChatHistorySidebarProps {
  userId: string;
  currentSessionId?: string;
  isOpen: boolean;
  onClose: () => void;
}

export function ChatHistorySidebar({
  userId,
  currentSessionId,
  isOpen,
  onClose
}: ChatHistorySidebarProps): JSX.Element | null {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const router = useRouter();
  const pathname = usePathname();

  const fetchSessions = useCallback(async () => {
    if (!userId) return;

    setIsLoading(true);
    try {
      const response = await fetch("/api/chat-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list" })
      });

      if (response.ok) {
        const data = await response.json();
        setSessions(data.sessions || []);
      }
    } catch (err) {
      console.error("[ChatHistory] Failed to fetch sessions:", err);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (isOpen && userId) {
      fetchSessions();
    }
  }, [isOpen, userId, fetchSessions]);

  const handleSelectSession = (sessionId: string) => {
    router.push(`/live-ocr/${sessionId}`);
    onClose();
  };

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();

    if (!confirm("Delete this chat? This cannot be undone.")) {
      return;
    }

    try {
      const response = await fetch("/api/chat-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          sessionId
        })
      });

      if (response.ok) {
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));

        // If we're viewing the deleted session, redirect to new chat
        if (currentSessionId === sessionId) {
          router.push("/live-ocr");
        }
      }
    } catch (err) {
      console.error("[ChatHistory] Failed to delete session:", err);
    }
  };

  const handleNewChat = () => {
    router.push("/live-ocr");
    onClose();
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40 lg:hidden"
        onClick={onClose}
      />

      {/* Sidebar */}
      <div className="fixed left-0 top-0 h-full w-80 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 z-50 flex flex-col shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="font-semibold text-lg flex items-center gap-2">
            <MessageSquare className="w-5 h-5" />
            Chat History
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* New Chat Button */}
        <div className="p-3">
          <button
            onClick={handleNewChat}
            className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
          >
            <MessageSquare className="w-4 h-4" />
            New Chat
          </button>
        </div>

        {/* Sessions List */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-4 text-center text-gray-500">
              <div className="animate-pulse space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-16 bg-gray-100 dark:bg-gray-800 rounded-lg" />
                ))}
              </div>
            </div>
          ) : sessions.length === 0 ? (
            <div className="p-4 text-center text-gray-500">
              <MessageSquare className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>No chat history yet</p>
              <p className="text-sm mt-1">Start a conversation to see it here</p>
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  onClick={() => handleSelectSession(session.id)}
                  className={`
                    group p-3 rounded-lg cursor-pointer transition-colors
                    ${currentSessionId === session.id
                      ? "bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800"
                      : "hover:bg-gray-100 dark:hover:bg-gray-800"
                    }
                  `}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">
                        {session.title || "New Chat"}
                      </p>
                      <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                        <Clock className="w-3 h-3" />
                        {formatDate(session.updated_at)}
                        <span className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-xs capitalize">
                          {session.mode.replace("_", " ")}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={(e) => handleDeleteSession(e, session.id)}
                      className="p-1.5 rounded opacity-0 group-hover:opacity-100 hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500 transition-all"
                      title="Delete chat"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-gray-200 dark:border-gray-800 text-center text-xs text-gray-400">
          {sessions.length} chat{sessions.length !== 1 ? "s" : ""} saved
        </div>
      </div>
    </>
  );
}
