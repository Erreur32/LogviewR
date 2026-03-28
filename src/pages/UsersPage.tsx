/**
 * Users Management Page
 * 
 * Page for managing users (admin only)
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Trash2, Shield, User as UserIcon, Mail, Calendar, Clock, CheckCircle, XCircle } from 'lucide-react';
import { api } from '../api/client';
import { useUserAuthStore, type User } from '../stores/userAuthStore';
import { Card } from '../components/widgets/Card';
import { Badge } from '../components/ui/Badge';

interface UsersPageProps {
    onBack: () => void;
}

const formatDate = (dateString?: string): string => {
    if (!dateString) return '—';
    try { return new Date(dateString).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }); }
    catch { return '—'; }
};

const getRoleLabel = (role: string): string =>
    role === 'admin' ? 'Administrateur' : role === 'user' ? 'Utilisateur' : 'Lecteur';

const getRoleBadgeVariant = (role: string): 'success' | 'info' | 'warning' | 'default' =>
    role === 'admin' ? 'info' : role === 'user' ? 'success' : 'default';

export const UsersPage: React.FC<UsersPageProps> = ({ onBack }) => {
    const { t } = useTranslation();
    const { user: currentUser } = useUserAuthStore();
    const [users, setUsers] = useState<User[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (currentUser?.role === 'admin') {
            fetchUsers();
        }
    }, [currentUser]);

    const fetchUsers = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await api.get<User[]>('/api/users');
            if (response.success && response.result) {
                setUsers(response.result);
            } else {
                const errorMsg = response.error?.message || t('admin.usersPage.loadError');
                setError(errorMsg);
            }
        } catch (err: any) {
            // Handle network/socket errors
            let errorMessage = t('admin.usersPage.loadError');
            
            if (err.message) {
                if (err.message.includes('socket') || err.message.includes('ended') || err.message.includes('ECONNRESET')) {
                    errorMessage = t('admin.usersPage.connectionError');
                } else if (err.message.includes('timeout') || err.message.includes('TIMEOUT')) {
                    errorMessage = t('admin.usersPage.timeoutError');
                } else if (err.error?.message) {
                    errorMessage = err.error.message;
                } else {
                    errorMessage = err.message;
                }
            } else if (err.error?.message) {
                errorMessage = err.error.message;
            }
            
            setError(errorMessage);
        } finally {
            setIsLoading(false);
        }
    };

    const handleDelete = async (userId: number) => {
        if (!confirm(t('admin.usersPage.deleteConfirm'))) {
            return;
        }

        try {
            const response = await api.delete(`/api/users/${userId}`);
            if (response.success) {
                await fetchUsers();
            } else {
                const errorMsg = response.error?.message || t('admin.usersPage.deleteError');
                alert(errorMsg);
            }
        } catch (err: any) {
            // Handle network/socket errors
            let errorMessage = t('admin.usersPage.deleteError');
            
            if (err.message) {
                if (err.message.includes('socket') || err.message.includes('ended') || err.message.includes('ECONNRESET')) {
                    errorMessage = t('admin.usersPage.connectionError');
                } else if (err.message.includes('timeout') || err.message.includes('TIMEOUT')) {
                    errorMessage = t('admin.usersPage.timeoutError');
                } else if (err.error?.message) {
                    errorMessage = err.error.message;
                } else {
                    errorMessage = err.message;
                }
            } else if (err.error?.message) {
                errorMessage = err.error.message;
            }
            
            alert(errorMessage);
        }
    };

    if (currentUser?.role !== 'admin') {
        return (
            <div className="min-h-screen bg-[#050505] text-gray-300 flex items-center justify-center">
                <div className="text-center">
                    <Shield size={48} className="mx-auto text-gray-600 mb-4" />
                    <p className="text-gray-400">{t('admin.usersPage.adminRequired')}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#050505] text-gray-300">
            <div className="max-w-7xl mx-auto p-6">
                {/* Header */}
                <div className="flex items-center gap-4 mb-6">
                    <button
                        onClick={onBack}
                        className="p-2 hover:bg-[#1a1a1a] rounded transition-colors"
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <h1 className="text-2xl font-semibold">{t('admin.usersPage.title')}</h1>
                </div>

                {/* Current User Profile */}
                {currentUser && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                        {/* Identity card */}
                        <div className="bg-[#121212] rounded-xl border border-gray-800 p-5">
                            <div className="flex items-center gap-4 mb-4">
                                <div className="w-14 h-14 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-lg shrink-0">
                                    {currentUser.username.slice(0, 2).toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                    <div className="font-semibold text-gray-100 text-lg truncate">{currentUser.username}</div>
                                    <Badge variant={getRoleBadgeVariant(currentUser.role)} size="sm">{getRoleLabel(currentUser.role)}</Badge>
                                </div>
                            </div>
                            <div className="space-y-2 text-sm">
                                <div className="flex items-center gap-2 text-gray-400">
                                    <Mail size={14} className="text-gray-500 shrink-0" />
                                    <span className="truncate">{currentUser.email || '—'}</span>
                                </div>
                                <div className="flex items-center gap-2 text-gray-400">
                                    <Calendar size={14} className="text-gray-500 shrink-0" />
                                    <span>{formatDate(currentUser.createdAt)}</span>
                                </div>
                                <div className="flex items-center gap-2 text-gray-400">
                                    <Clock size={14} className="text-gray-500 shrink-0" />
                                    <span>{formatDate(currentUser.lastLogin)}</span>
                                </div>
                            </div>
                        </div>
                        {/* Status card */}
                        <div className="bg-[#121212] rounded-xl border border-gray-800 p-5">
                            <div className="text-xs text-gray-500 uppercase tracking-wider mb-4">Informations du compte</div>
                            <div className="space-y-3 text-sm">
                                <div className="flex items-center justify-between">
                                    <span className="text-gray-500">ID</span>
                                    <span className="text-gray-300 font-mono">#{currentUser.id}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-gray-500">Rôle</span>
                                    <Badge variant={getRoleBadgeVariant(currentUser.role)} size="sm">{getRoleLabel(currentUser.role)}</Badge>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-gray-500">Statut</span>
                                    <div className="flex items-center gap-1.5">
                                        {currentUser.enabled
                                            ? <><CheckCircle size={14} className="text-green-400" /><span className="text-green-400">Actif</span></>
                                            : <><XCircle size={14} className="text-red-400" /><span className="text-red-400">Désactivé</span></>
                                        }
                                    </div>
                                </div>
                                {currentUser.lastLoginIp && (
                                    <div className="flex items-center justify-between">
                                        <span className="text-gray-500">Dernière IP</span>
                                        <span className="text-gray-300 font-mono text-xs">{currentUser.lastLoginIp}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {error && (
                    <div className="mb-4 p-3 bg-red-900/30 border border-red-700 rounded text-red-400 text-sm">
                        {error}
                    </div>
                )}

                {/* Users List */}
                {isLoading ? (
                    <div className="text-center py-12 text-gray-500">{t('admin.usersPage.loading')}</div>
                ) : (
                    <div className="grid gap-4">
                        {users.map((user) => (
                            <Card key={user.id} title={user.username}>
                                <div className="flex items-center justify-between">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-2">
                                            <UserIcon size={16} className="text-gray-400" />
                                            <span className="font-medium">{user.username}</span>
                                            {user.role === 'admin' && (
                                                <span className="px-2 py-0.5 bg-blue-900/30 border border-blue-700 rounded text-xs text-blue-400">
                                                    {t('admin.users.admin')}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-sm text-gray-400">{user.email}</p>
                                        <p className="text-xs text-gray-500 mt-1">
                                            {t('admin.usersPage.createdOn', { date: new Date(user.createdAt).toLocaleDateString() })}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {user.id !== currentUser?.id && (
                                            <button
                                                onClick={() => handleDelete(user.id)}
                                                className="p-2 hover:bg-red-900/20 rounded text-red-400 hover:text-red-300 transition-colors"
                                                title={t('admin.users.delete')}
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </Card>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

