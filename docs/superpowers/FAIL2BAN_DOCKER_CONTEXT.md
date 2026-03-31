# Contexte : Intégration Fail2ban ↔ Docker (LogviewR)

## Architecture système

- **Fail2ban** est installé en **natif sur l'hôte Debian** (via `apt`) — pas en Docker.
- **LogviewR** tourne en Docker et doit pouvoir **lire, modifier la config** et **contrôler fail2ban** depuis le container.
- CrowdSec n'est pas encore en place, on garde fail2ban pour l'instant.

---

## Ce qui fonctionne déjà

- Lecture des logs fail2ban via mount `/var/log:ro`
- Lecture de la config via mount `/etc/fail2ban:ro`

---

## Ce qu'on veut ajouter

1. **Modifier la config** fail2ban depuis le container → passer `/etc/fail2ban` en `:rw`
2. **Contrôler fail2ban** (reload, status, ban/unban) → via le **socket Unix**

---

## La clé : le socket fail2ban

Fail2ban expose un socket de contrôle sur l'hôte :
```
/var/run/fail2ban/fail2ban.sock
```

En montant ce socket dans le container, `fail2ban-client` peut piloter
le daemon hôte **sans `--privileged`**.

### Commandes disponibles via socket
```bash
fail2ban-client reload          # Recharge la config (après modif)
fail2ban-client status          # Status global
fail2ban-client status sshd     # Status d'une jail
fail2ban-client set sshd unbanip 1.2.3.4
fail2ban-client set sshd banip  1.2.3.4
```

> ⚠️ `systemctl restart fail2ban` n'est **pas possible** depuis Docker.
> `fail2ban-client reload` suffit dans 99% des cas après une modif de config.

---

## docker-compose — volumes requis

```yaml
volumes:
  - /var/log:/var/log:ro                                      # Logs (lecture)
  - /etc/fail2ban:/etc/fail2ban:rw                            # Config (écriture)
  - /var/run/fail2ban/fail2ban.sock:/var/run/fail2ban/fail2ban.sock  # Socket contrôle
```

---

## Prérequis dans le container

- `fail2ban-client` doit être installé dans l'image (ou via Dockerfile custom)
- Le container doit avoir accès au socket :

```yaml
user: "0:0"   # root, option simple
# OU
group_add:
  - "fail2ban"  # si le GID du groupe fail2ban est connu
```

### Vérifier les permissions du socket sur l'hôte
```bash
ls -la /var/run/fail2ban/fail2ban.sock
# srw-rw---- 1 root fail2ban ...
```

---

## Dockerfile custom si fail2ban-client absent de l'image

```dockerfile
FROM erreur32/logviewr:latest
RUN apt-get update && apt-get install -y fail2ban \
    && rm -rf /var/lib/apt/lists/*
```

> On installe le package `fail2ban` pour avoir `fail2ban-client`,
> mais le **daemon ne démarre pas** dans le container — il communique
> uniquement avec le daemon de l'hôte via le socket monté.

---

## Résumé des capacités

| Action                  | Possible depuis Docker | Méthode                        |
|-------------------------|------------------------|--------------------------------|
| Lire les logs           | ✅                     | `/var/log:ro`                  |
| Lire la config          | ✅                     | `/etc/fail2ban:ro`             |
| Modifier la config      | ✅                     | `/etc/fail2ban:rw`             |
| Reload après modif      | ✅                     | `fail2ban-client reload`       |
| Status / ban / unban    | ✅                     | `fail2ban-client` via socket   |
| Restart systemd complet | ❌                     | Non faisable proprement        |
