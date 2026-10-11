import { useAuth } from '../../../contexts/AuthContext';
import { puedeDocumentar } from '../../../utils/turnos';
import ComentariosTurno from './ComentariosTurno';
import AdjuntosTurno from './AdjuntosTurno';

/** Comentarios y archivos de un turno. Se monta solo cuando se abre el turno. */
export default function DocumentacionTurno({ apt, onCambio }) {
  const { user } = useAuth();
  const puedeEscribir = puedeDocumentar(user, apt);
  const esDueno = user?.role === 'owner' && !user?.isPlatformTeam;

  return (
    <div className="doc-turno">
      <ComentariosTurno appointmentId={apt.id} puedeEscribir={puedeEscribir} esDueno={esDueno} onCambio={onCambio} />
      <AdjuntosTurno appointmentId={apt.id} puedeEscribir={puedeEscribir} esDueno={esDueno} onCambio={onCambio} />
    </div>
  );
}
