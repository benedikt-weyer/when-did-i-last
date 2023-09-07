import { StatusBar } from 'expo-status-bar';
import { ScrollView, Text, View } from 'react-native';
import WDILCard from './WDILCard';
import { MMKVLoader, useMMKVStorage } from 'react-native-mmkv-storage';

const storage = new MMKVLoader().initialize();

const HomeScreen = () => {
    const [question1, setQuestion1] = useMMKVStorage('question1', storage, 'clean');
    
    return (
		<View className="flex-1 justify-start bg-[#F5EFB9] py-3 px-2">
            <StatusBar style="auto" />

            <ScrollView>
                <WDILCard question={question1} timeSinceEvent='4 days' />

                <WDILCard question='sweap the bathroom floor' timeSinceEvent='2 days' />

                <WDILCard question='shower' timeSinceEvent='1 day' />

                <WDILCard question='give birth to 10 childs including a neat looking squirrel' timeSinceEvent='2 days' />

                <WDILCard question='clean the kitchen' timeSinceEvent='4 days' />

                <WDILCard question='sweap the bathroom floor' timeSinceEvent='2 days' />

                <WDILCard question='clean the kitchen' timeSinceEvent='4 days' />

                <WDILCard question='sweap the bathroom floor' timeSinceEvent='2 days' />
            </ScrollView>
			
			
			
		</View>
    );
};

export default HomeScreen;