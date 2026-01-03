/**
 * User Login Modal
 * 
 * Modal for user authentication (JWT-based)
 */

import React, { useState, useEffect } from 'react';
import { X, LogIn, AlertCircle, AlertTriangle, ExternalLink } from 'lucide-react';
import { useUserAuthStore } from '../../stores/userAuthStore';
import { api } from '../../api/client';

interface UserLoginModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: () => void;
}

export const UserLoginModal: React.FC<UserLoginModalProps> = ({ isOpen, onClose, onSuccess }) => {
    const { login, isLoading, error, clearError } = useUserAuthStore();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
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
                    // Silently fail - don't block login if check fails
                    console.error('Failed to check JWT_SECRET status:', err);
                }
            };
            checkJwtSecret();
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        clearError();

        const success = await login(username, password);
        if (success) {
            setUsername('');
            setPassword('');
            onSuccess?.();
            onClose();
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
            <div className="bg-[#121212] border border-gray-700 rounded-lg p-6 w-full max-w-md">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                        <LogIn size={20} />
                        Connexion
                    </h2>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
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
                    
                    {error && (
                        <div className="bg-red-900/30 border border-red-700 rounded p-3 flex items-start gap-2 text-red-400 text-sm">
                            <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}

                    <div>
                        <label htmlFor="username" className="block text-sm text-gray-400 mb-2">
                            Nom d'utilisateur
                        </label>
                        <input
                            id="username"
                            name="username"
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            className="w-full bg-[#1a1a1a] border border-gray-700 rounded px-3 py-2 text-white focus:outline-none focus:outline-none"
                            required
                            autoFocus
                        />
                    </div>

                    <div>
                        <label htmlFor="password" className="block text-sm text-gray-400 mb-2">
                            Mot de passe
                        </label>
                        <input
                            id="password"
                            name="password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full bg-[#1a1a1a] border border-gray-700 rounded px-3 py-2 text-white focus:outline-none focus:outline-none"
                            required
                        />
                    </div>

                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-2 bg-[#1a1a1a] border border-gray-700 rounded text-gray-300 hover:bg-[#252525] transition-colors"
                        >
                            Annuler
                        </button>
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isLoading ? 'Connexion...' : 'Se connecter'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

