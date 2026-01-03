/**
 * User Registration Modal
 * 
 * Modal for creating the first admin user when no users exist
 */

import React, { useState, useEffect } from 'react';
import { X, UserPlus, AlertCircle, CheckCircle, AlertTriangle, ExternalLink } from 'lucide-react';
import { api } from '../../api/client';
import { useUserAuthStore } from '../../stores/userAuthStore';

interface UserRegistrationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: () => void;
}

export const UserRegistrationModal: React.FC<UserRegistrationModalProps> = ({ isOpen, onClose, onSuccess }) => {
    const { login } = useUserAuthStore();
    const [formData, setFormData] = useState({
        username: '',
        email: '',
        password: '',
        confirmPassword: ''
    });
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const [jwtSecretWarning, setJwtSecretWarning] = useState<{ isDefault: boolean; message: string } | null>(null);
    
    // Check JWT_SECRET status when modal opens
    useEffect(() => {
        if (isOpen) {
            const checkJwtSecret = async () => {
                try {
                    const response = await api.get<{ jwtSecretIsDefault: boolean; message: string }>('/api/system/security-status');
                    if (response.success && response.result) {
                        if (response.result.jwtSecretIsDefault) {
                            setJwtSecretWarning({
                                isDefault: true,
                                message: response.result.message
                            });
                        } else {
                            setJwtSecretWarning(null);
                        }
                    }
                } catch (err) {
                    // Silently fail - don't block registration if check fails
                    console.error('Failed to check JWT_SECRET status:', err);
                }
            };
            checkJwtSecret();
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccess(false);

        // Validation
        if (!formData.username || !formData.email || !formData.password) {
            setError('Tous les champs sont requis');
            return;
        }

        if (formData.password.length < 8) {
            setError('Le mot de passe doit contenir au moins 8 caractères');
            return;
        }

        if (formData.password !== formData.confirmPassword) {
            setError('Les mots de passe ne correspondent pas');
            return;
        }

        setIsLoading(true);

        try {
            // Register the user
            const response = await api.post('/api/users/register', {
                username: formData.username,
                email: formData.email,
                password: formData.password,
                role: 'admin' // First user is always admin
            });

            if (response.success) {
                setSuccess(true);
                
                // Auto-login after registration
                setTimeout(async () => {
                    const loginSuccess = await login(formData.username, formData.password);
                    if (loginSuccess) {
                        setFormData({ username: '', email: '', password: '', confirmPassword: '' });
                        onSuccess?.();
                        onClose();
                    }
                }, 1000);
            } else {
                setError(response.error?.message || 'Erreur lors de la création du compte');
            }
        } catch (err: any) {
            const errorMessage = err?.error?.message || err?.message || 'Erreur lors de la création du compte';
            setError(errorMessage);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
            <div className="bg-[#121212] border border-gray-700 rounded-lg p-6 w-full max-w-md">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                        <UserPlus size={20} />
                        Créer le compte administrateur
                    </h2>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white transition-colors"
                        disabled={isLoading}
                    >
                        <X size={20} />
                    </button>
                </div>

                {jwtSecretWarning && jwtSecretWarning.isDefault && (
                    <div className="bg-amber-900/30 border border-amber-700 rounded-lg p-4 mb-4">
                        <div className="flex items-start gap-3">
                            <AlertTriangle size={20} className="text-amber-400 mt-0.5 flex-shrink-0" />
                            <div className="flex-1">
                                <h3 className="text-sm font-semibold text-amber-400 mb-2">
                                    ⚠️ JWT_SECRET non configuré
                                </h3>
                                <p className="text-xs text-amber-300 mb-3">
                                    Le secret JWT n'est pas configuré ou utilise la valeur par défaut. 
                                    <strong className="text-amber-200"> C'est un risque de sécurité important !</strong>
                                </p>
                                <div className="bg-amber-950/50 border border-amber-800 rounded p-3 mb-3">
                                    <p className="text-xs font-semibold text-amber-200 mb-2">Comment corriger :</p>
                                    <ol className="text-xs text-amber-300 space-y-1.5 list-decimal list-inside">
                                        <li>
                                            <strong>Générer un secret sécurisé :</strong>
                                            <code className="block mt-1 px-2 py-1 bg-black/50 rounded text-amber-100 font-mono text-[10px]">
                                                openssl rand -base64 32
                                            </code>
                                        </li>
                                        <li>
                                            <strong>Docker Compose :</strong> Ajouter dans votre fichier <code className="text-amber-200">.env</code> ou <code className="text-amber-200">docker-compose.yml</code> :
                                            <code className="block mt-1 px-2 py-1 bg-black/50 rounded text-amber-100 font-mono text-[10px]">
                                                JWT_SECRET=votre_secret_genere_ici
                                            </code>
                                        </li>
                                        <li>
                                            <strong>Redémarrer le conteneur :</strong>
                                            <code className="block mt-1 px-2 py-1 bg-black/50 rounded text-amber-100 font-mono text-[10px]">
                                                docker-compose restart
                                            </code>
                                        </li>
                                    </ol>
                                </div>
                                <p className="text-xs text-amber-300/80 italic">
                                    💡 Le message disparaîtra automatiquement une fois le JWT_SECRET correctement configuré et le conteneur redémarré.
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {success ? (
                    <div className="space-y-4">
                        <div className="bg-green-900/30 border border-green-700 rounded p-4 flex items-start gap-3">
                            <CheckCircle size={20} className="text-green-400 mt-0.5 flex-shrink-0" />
                            <div>
                                <p className="text-green-400 font-medium">Compte créé avec succès !</p>
                                <p className="text-green-300 text-sm mt-1">Connexion en cours...</p>
                            </div>
                        </div>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="bg-blue-900/30 border border-blue-700 rounded p-3 text-blue-300 text-sm">
                            <p className="font-medium mb-1">Premier utilisateur</p>
                            <p>Créez le compte administrateur pour commencer à utiliser LogviewR.</p>
                        </div>

                        {error && (
                            <div className="bg-red-900/30 border border-red-700 rounded p-3 flex items-start gap-2 text-red-400 text-sm">
                                <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                                <span>{error}</span>
                            </div>
                        )}

                        <div>
                            <label htmlFor="username" className="block text-sm text-gray-400 mb-2">
                                Nom d'utilisateur *
                            </label>
                            <input
                                id="username"
                                name="username"
                                type="text"
                                value={formData.username}
                                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                                className="w-full bg-[#1a1a1a] border border-gray-700 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                                required
                                autoFocus
                                disabled={isLoading}
                            />
                        </div>

                        <div>
                            <label htmlFor="email" className="block text-sm text-gray-400 mb-2">
                                Email *
                            </label>
                            <input
                                id="email"
                                name="email"
                                type="email"
                                value={formData.email}
                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                className="w-full bg-[#1a1a1a] border border-gray-700 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                                required
                                disabled={isLoading}
                            />
                        </div>

                        <div>
                            <label htmlFor="password" className="block text-sm text-gray-400 mb-2">
                                Mot de passe *
                            </label>
                            <input
                                id="password"
                                name="password"
                                type="password"
                                value={formData.password}
                                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                className="w-full bg-[#1a1a1a] border border-gray-700 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                                required
                                disabled={isLoading}
                                minLength={8}
                            />
                            <p className="text-xs text-gray-500 mt-1">Minimum 8 caractères</p>
                        </div>

                        <div>
                            <label htmlFor="confirmPassword" className="block text-sm text-gray-400 mb-2">
                                Confirmer le mot de passe *
                            </label>
                            <input
                                id="confirmPassword"
                                name="confirmPassword"
                                type="password"
                                value={formData.confirmPassword}
                                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                                className="w-full bg-[#1a1a1a] border border-gray-700 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                                required
                                disabled={isLoading}
                            />
                        </div>

                        <div className="flex gap-3 pt-2">
                            <button
                                type="button"
                                onClick={onClose}
                                className="flex-1 px-4 py-2 bg-[#1a1a1a] border border-gray-700 rounded text-gray-300 hover:bg-[#252525] transition-colors disabled:opacity-50"
                                disabled={isLoading}
                            >
                                Annuler
                            </button>
                            <button
                                type="submit"
                                disabled={isLoading}
                                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isLoading ? 'Création...' : 'Créer le compte'}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
};
