import { Modal } from 'antd';
import './app-dialog.scss';

// Confirmation and form dialogs share the settings panel's surface and spacing.
export default function AppDialog({ rootClassName = '', ...props }) {
  return <Modal centered {...props} rootClassName={`moki-dialog-root ${rootClassName}`} />;
}
