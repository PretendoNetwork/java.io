import { registerClass } from '@/java-object-input-stream';
import type JavaObjectInputStream from '@/java-object-input-stream';
import type { JavaClassDescription } from '@/types/java';

export default class ArrayList {
	readObject(ois: JavaObjectInputStream, classDescription: JavaClassDescription) {
		ois.defaultReadObject(classDescription);

		const blockDataSize = ois.readBlockHeader();

		if (blockDataSize !== 4n) {
			throw new Error(`Unsupported ArrayList block data size ${blockDataSize}`);
		}

		classDescription.data.capacity = ois.readInt();
		classDescription.data.elements = [];

		for (let i = 0; i < classDescription.data.size; i++) {
			classDescription.data.elements.push(ois.readObject());
		}
	}
}

registerClass('java.util.ArrayList', ArrayList);