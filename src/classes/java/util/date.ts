import { registerClass } from '@/java-object-input-stream';
import type JavaObjectInputStream from '@/java-object-input-stream';
import type { JavaClassDescription } from '@/types/java';

export default class JavaDate {
	readObject(ois: JavaObjectInputStream, classDescription: JavaClassDescription) {
		ois.defaultReadObject(classDescription);

		const blockDataSize = ois.readBlockHeader();

		if (blockDataSize !== 8n) {
			throw new Error(`Unsupported Date block data size ${blockDataSize}`);
		}

		classDescription.data.fastTime = ois.readLong();
	}
}

registerClass('java.util.Date', JavaDate);